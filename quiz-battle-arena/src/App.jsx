
import { useCallback, useEffect, useState } from "react";
import "./App.css";

const API_URL = (
  import.meta.env.VITE_API_URL || "http://127.0.0.1:8000"
).replace(/\/$/, "");

async function request(path, options = {}) {
  const response = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(data.detail || "Something went wrong.");
  }

  return data;
}

export default function App() {
  const [nickname, setNickname] = useState("");
  const [roomCode, setRoomCode] = useState("");
  const [room, setRoom] = useState(null);
  const [playerId, setPlayerId] = useState("");
  const [sessionToken, setSessionToken] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [selectedAnswer, setSelectedAnswer] = useState(null);
  const [feedback, setFeedback] = useState("");

  const myPlayer = room?.players?.find(
    (player) => player.id === playerId
  );

  const everyoneReady =
    Boolean(room?.players?.length) &&
    room.players.every((player) => player.ready);

  const canStart =
    room?.status === "lobby" &&
    room.players.length >= 2 &&
    everyoneReady;

  const isHost = Boolean(myPlayer?.is_host);
  const question = room?.question;
  const alreadyAnswered =
    room?.answered_player_ids?.includes(playerId) ?? false;

  async function enterRoom(data) {
    setRoom(data.room);
    setPlayerId(data.player_id);
    setSessionToken(data.session_token);
    setRoomCode(data.room.code);
    setError("");
    setFeedback("");
    setSelectedAnswer(null);

    sessionStorage.setItem("quizPlayerId", data.player_id);
    sessionStorage.setItem("quizSessionToken", data.session_token);
    sessionStorage.setItem("quizRoomCode", data.room.code);

    window.history.pushState({}, "", `/room/${data.room.code}`);
  }

  async function createRoom() {
    setError("");

    if (!nickname.trim()) {
      setError("Please enter your nickname.");
      return;
    }

    setLoading(true);
    try {
      const data = await request("/rooms", {
        method: "POST",
        body: JSON.stringify({ nickname: nickname.trim() }),
      });
      await enterRoom(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function joinRoom() {
    setError("");

    if (!nickname.trim()) {
      setError("Please enter your nickname.");
      return;
    }

    if (!roomCode.trim()) {
      setError("Please enter a room code.");
      return;
    }

    setLoading(true);
    try {
      const data = await request(
        `/rooms/${roomCode.trim().toUpperCase()}/join`,
        {
          method: "POST",
          body: JSON.stringify({ nickname: nickname.trim() }),
        }
      );
      await enterRoom(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  const refreshRoom = useCallback(async () => {
    if (!room?.code) return;

    try {
      const data = await request(`/rooms/${room.code}`);

      setRoom((previous) => {
        if (
          previous?.question_number !== data.question_number ||
          previous?.status !== data.status
        ) {
          setSelectedAnswer(null);
          setFeedback("");
        }
        return data;
      });
    } catch (err) {
      setError(err.message);
    }
  }, [room?.code]);

  useEffect(() => {
    if (!room?.code) return;

    const interval = setInterval(refreshRoom, 1000);
    return () => clearInterval(interval);
  }, [room?.code, refreshRoom]);

  async function toggleReady() {
    if (!room || !sessionToken || !myPlayer) return;

    setError("");
    try {
      const data = await request(`/rooms/${room.code}/ready`, {
        method: "PATCH",
        headers: { "X-Session-Token": sessionToken },
        body: JSON.stringify({ ready: !myPlayer.ready }),
      });
      setRoom(data.room);
    } catch (err) {
      setError(err.message);
    }
  }

  async function startGame() {
    if (!room || !sessionToken) return;

    setError("");
    try {
      const data = await request(`/rooms/${room.code}/start`, {
        method: "POST",
        headers: { "X-Session-Token": sessionToken },
      });
      setRoom(data.room);
      setSelectedAnswer(null);
      setFeedback("");
    } catch (err) {
      setError(err.message);
    }
  }

  async function submitAnswer(index) {
    if (!room || !sessionToken || alreadyAnswered || selectedAnswer !== null) {
      return;
    }

    setSelectedAnswer(index);
    setError("");

    try {
      const data = await request(`/rooms/${room.code}/answer`, {
        method: "POST",
        headers: { "X-Session-Token": sessionToken },
        body: JSON.stringify({ answer_index: index }),
      });

      setRoom(data.room);
      setFeedback(
        data.correct
          ? `Correct! +${data.points_earned} points`
          : "Not quite! No points this time."
      );
    } catch (err) {
      setSelectedAnswer(null);
      setError(err.message);
    }
  }

  async function copyInvite() {
    if (!room) return;

    try {
      await navigator.clipboard.writeText(
        `${window.location.origin}/room/${room.code}\nRoom code: ${room.code}`
      );
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      setError(`Your room code is ${room.code}. Copy it manually.`);
    }
  }

  function backToHome() {
    setRoom(null);
    setPlayerId("");
    setSessionToken("");
    setError("");
    setFeedback("");
    setSelectedAnswer(null);

    sessionStorage.removeItem("quizPlayerId");
    sessionStorage.removeItem("quizSessionToken");
    sessionStorage.removeItem("quizRoomCode");

    window.history.pushState({}, "", "/");
  }

  function playAgain() {
    backToHome();
  }

  return (
    <div className="app">
      <nav className="navbar">
        <div className="brand">
          <span className="brand-icon">⚡</span>
          Quiz Battle Arena
        </div>
        <span className="nav-tag">MULTIPLAYER</span>
      </nav>

      {!room ? (
        <main className="hero">
          <div className="hero-badge">🎮 YOUR KNOWLEDGE. YOUR BATTLE.</div>
          <h1>Think fast.<br /><span>Win together.</span></h1>
          <p className="hero-description">
            Challenge your friends in a live quiz battle.
            Create a room or join one to get started.
          </p>

          <section className="game-card">
            <label htmlFor="nickname">YOUR NICKNAME</label>
            <input
              id="nickname"
              value={nickname}
              onChange={(e) => setNickname(e.target.value)}
              placeholder="Enter your nickname"
              maxLength={20}
            />

            <button
              className="primary-button"
              onClick={createRoom}
              disabled={loading}
            >
              {loading ? "Please wait..." : "＋ Create a Room"}
            </button>

            <div className="or-divider"><span>OR JOIN A ROOM</span></div>

            <label htmlFor="room-code">ROOM CODE</label>
            <div className="join-row">
              <input
                id="room-code"
                value={roomCode}
                onChange={(e) => setRoomCode(e.target.value.toUpperCase())}
                placeholder="Enter 6-character code"
                maxLength={6}
              />
              <button
                className="secondary-button"
                onClick={joinRoom}
                disabled={loading}
              >
                Join
              </button>
            </div>

            {error && <p className="error-message">{error}</p>}
          </section>

          <div className="feature-row">
            <span>👥 2–4 players</span>
            <span>⚡ Speed scoring</span>
            <span>🌐 Play together</span>
          </div>
        </main>
      ) : (
        <main className="lobby">
          <div className="lobby-topline">
            <button className="text-button" onClick={backToHome}>
              ← Leave room
            </button>
            <span className="lobby-status">
              {room.status === "lobby"
                ? "● WAITING ROOM"
                : room.status === "playing"
                ? "● LIVE QUIZ"
                : "● RESULTS"}
            </span>
          </div>

          {room.status === "lobby" && (
            <>
              <div className="lobby-title">
                <div className="hero-badge">YOUR BATTLE STARTS HERE</div>
                <h1>Waiting for <span>players.</span></h1>
                <p>Invite friends and get everyone ready.</p>
              </div>

              <section className="lobby-card">
                <div className="room-code-heading">
                  <div>
                    <label>ROOM CODE</label>
                    <div className="room-code">{room.code}</div>
                  </div>
                  <button className="secondary-button" onClick={copyInvite}>
                    {copied ? "Copied!" : "Copy invite"}
                  </button>
                </div>

                <div className="lobby-player-heading">
                  <h2>Players</h2>
                  <span>{room.players.length}/4 joined</span>
                </div>

                <div className="player-list">
                  {room.players.map((player, index) => (
                    <div className="player-row" key={player.id}>
                      <div className="player-avatar">
                        {player.nickname.charAt(0).toUpperCase()}
                      </div>
                      <div className="player-info">
                        <strong>
                          {player.nickname}
                          {player.id === playerId ? " (You)" : ""}
                        </strong>
                        <span>{player.is_host ? "Room host" : `Player ${index + 1}`}</span>
                      </div>
                      <span className={`player-status ${player.ready ? "ready" : "not-ready"}`}>
                        {player.ready ? "✓ Ready" : "Not ready"}
                      </span>
                    </div>
                  ))}
                </div>

                <button
                  className={`primary-button ready-button ${myPlayer?.ready ? "is-ready" : ""}`}
                  onClick={toggleReady}
                  disabled={!myPlayer}
                >
                  {myPlayer?.ready ? "✓ Ready — Click to Cancel" : "I'm Ready"}
                </button>

                {isHost ? (
                  <button
                    className="start-button"
                    onClick={startGame}
                    disabled={!canStart}
                  >
                    {room.players.length < 2
                      ? "Start Game — Need 2 Players"
                      : !everyoneReady
                      ? "Start Game — Waiting for Everyone"
                      : "⚡ Start Game"}
                  </button>
                ) : (
                  <p className="waiting-note">
                    The host will start when everyone is ready.
                  </p>
                )}
              </section>
            </>
          )}

          {room.status === "playing" && question && (
            <section className="quiz-card">
              <div className="quiz-progress">
                <span>QUESTION {room.question_number} OF {room.total_questions}</span>
                <span className={question.remaining_seconds <= 5 ? "timer urgent" : "timer"}>
                  ⏱ {question.remaining_seconds}s
                </span>
              </div>

              <div className="timer-track">
                <div
                  className="timer-fill"
                  style={{
                    width: `${(question.remaining_seconds / question.time_limit) * 100}%`,
                  }}
                />
              </div>

              <h1 className="question-title">{question.text}</h1>

              <div className="answer-grid">
                {question.options.map((option, index) => (
                  <button
                    key={`${room.question_number}-${index}`}
                    className={`answer-option ${selectedAnswer === index ? "answer-selected" : ""}`}
                    onClick={() => submitAnswer(index)}
                    disabled={alreadyAnswered || selectedAnswer !== null}
                  >
                    <span className="answer-letter">
                      {String.fromCharCode(65 + index)}
                    </span>
                    {option}
                  </button>
                ))}
              </div>

              {alreadyAnswered && (
                <p className="waiting-note">
                  Answer submitted. Waiting for other players or the timer…
                </p>
              )}

              {feedback && <p className="answer-feedback">{feedback}</p>}
              {error && <p className="error-message">{error}</p>}

              <div className="live-scoreboard">
                <h2>Live scores</h2>
                {[...room.players]
                  .sort((a, b) => b.score - a.score)
                  .map((player, index) => (
                    <div className="score-row" key={player.id}>
                      <span>{index + 1}. {player.nickname}{player.id === playerId ? " (You)" : ""}</span>
                      <strong>{player.score} pts</strong>
                    </div>
                  ))}
              </div>
            </section>
          )}

          {room.status === "completed" && (
            <section className="lobby-card results-card">
              <div className="hero-badge">🏆 QUIZ COMPLETE</div>
              <h1 className="results-title">Battle <span>results.</span></h1>
              <p className="hero-description">
                Final scores after {room.total_questions} questions.
              </p>

              <div className="final-leaderboard">
                {(room.final_results || room.players)
                  .map((player, index) => (
                    <div className="final-player" key={player.id}>
                      <span className="final-rank">
                        {index === 0 ? "🏆" : `#${index + 1}`}
                      </span>
                      <div className="player-info">
                        <strong>
                          {player.nickname}{player.id === playerId ? " (You)" : ""}
                        </strong>
                        <span>{index === 0 ? "Champion" : "Quiz player"}</span>
                      </div>
                      <strong>{player.score} pts</strong>
                    </div>
                  ))}
              </div>

              <button className="primary-button" onClick={playAgain}>
                Play Again
              </button>
              <p className="waiting-note">
                Play Again returns you to the home screen so you can create a new room.
              </p>
            </section>
          )}

          {error && room.status === "lobby" && (
            <p className="error-message">{error}</p>
          )}

          <button className="text-button refresh-button" onClick={refreshRoom}>
            ↻ Refresh room
          </button>
        </main>
      )}

      <footer className="footer">
        QUIZ BATTLE ARENA <span>•</span> THINK FAST. PLAY TOGETHER.
      </footer>
    </div>
  );
}

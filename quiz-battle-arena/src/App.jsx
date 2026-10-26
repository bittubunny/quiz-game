
import { useCallback, useEffect, useState } from "react";
import "./App.css";

const API_URL = (
  import.meta.env.VITE_API_URL || "http://127.0.0.1:8000"
).replace(/\/$/, "");

const COLORS = ["green", "blue", "red", "yellow"];

const COLOR_EMOJI = {
  green: "🟢",
  blue: "🔵",
  red: "🔴",
  yellow: "🟡",
};

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
  const [selectedTile, setSelectedTile] = useState(null);
  const [submittingTile, setSubmittingTile] = useState(false);

  const myPlayer = room?.players?.find(
    (player) => player.id === playerId
  );

  const isHost = Boolean(myPlayer?.is_host);

  const everyoneReady =
    Boolean(room?.players?.length) &&
    room.players.every((player) => player.ready);

  const canStart =
    room?.status === "lobby" &&
    room.players.length >= 2 &&
    everyoneReady;

  const floorGame = room?.floor_game;
  const isFloorGame = room?.game_mode === "floor";

  const alreadySelected =
    floorGame?.selected_player_ids?.includes(playerId) ?? false;

  const canChooseTile =
    room?.status === "playing" &&
    isFloorGame &&
    floorGame?.phase === "choosing" &&
    !alreadySelected &&
    selectedTile === null &&
    !submittingTile;

  // ----------------------------------------------------------
  // ENTER ROOM
  // ----------------------------------------------------------

  function enterRoom(data) {
    setRoom(data.room);
    setPlayerId(data.player_id);
    setSessionToken(data.session_token);
    setRoomCode(data.room.code);
    setError("");
    setSelectedTile(null);
    setSubmittingTile(false);

    sessionStorage.setItem("quizPlayerId", data.player_id);
    sessionStorage.setItem("quizSessionToken", data.session_token);
    sessionStorage.setItem("quizRoomCode", data.room.code);

    window.history.pushState(
      {},
      "",
      `/room/${data.room.code}`
    );
  }

  // ----------------------------------------------------------
  // CREATE ROOM
  // ----------------------------------------------------------

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
        body: JSON.stringify({
          nickname: nickname.trim(),
        }),
      });

      enterRoom(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  // ----------------------------------------------------------
  // JOIN ROOM
  // ----------------------------------------------------------

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
          body: JSON.stringify({
            nickname: nickname.trim(),
          }),
        }
      );

      enterRoom(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  // ----------------------------------------------------------
  // REFRESH ROOM STATE
  // ----------------------------------------------------------

  const refreshRoom = useCallback(async () => {
    if (!room?.code) return;

    try {
      const data = await request(`/rooms/${room.code}`);

      setRoom((previous) => {
        if (
          previous?.question_number !== data.question_number ||
          previous?.status !== data.status ||
          previous?.floor_game?.round_number !==
            data.floor_game?.round_number ||
          previous?.floor_game?.phase !==
            data.floor_game?.phase
        ) {
          setSelectedTile(null);
          setSubmittingTile(false);
        }

        return data;
      });

      setError("");
    } catch (err) {
      setError(err.message);
    }
  }, [room?.code]);

  useEffect(() => {
    if (!room?.code) return;

    const interval = setInterval(refreshRoom, 700);
    return () => clearInterval(interval);
  }, [room?.code, refreshRoom]);

  // ----------------------------------------------------------
  // RESTORE EXISTING SESSION WHEN OPENING A ROOM URL
  // ----------------------------------------------------------

  useEffect(() => {
    const match = window.location.pathname.match(
      /^\/room\/([A-Za-z0-9]+)\/?$/
    );

    if (!match) return;

    const savedCode = match[1].toUpperCase();
    const savedPlayerId = sessionStorage.getItem("quizPlayerId");
    const savedToken = sessionStorage.getItem("quizSessionToken");
    const storedCode = sessionStorage.getItem("quizRoomCode");

    if (
      !savedPlayerId ||
      !savedToken ||
      storedCode?.toUpperCase() !== savedCode
    ) {
      setRoomCode(savedCode);
      setError(
        "Enter your nickname and join this room to play on this browser."
      );
      window.history.replaceState({}, "", "/");
      return;
    }

    let cancelled = false;

    async function restoreSession() {
      try {
        const data = await request(`/rooms/${savedCode}`);

        if (cancelled) return;

        const playerExists = data.players.some(
          (player) => player.id === savedPlayerId
        );

        if (!playerExists) {
          throw new Error(
            "Your player session is no longer in this room. Please rejoin."
          );
        }

        setRoom(data);
        setRoomCode(savedCode);
        setPlayerId(savedPlayerId);
        setSessionToken(savedToken);
        setError("");
      } catch (err) {
        if (!cancelled) {
          setError(err.message);
          window.history.replaceState({}, "", "/");
        }
      }
    }

    restoreSession();

    return () => {
      cancelled = true;
    };
  }, []);

  // ----------------------------------------------------------
  // READY STATUS
  // ----------------------------------------------------------

  async function toggleReady() {
    if (!room || !sessionToken || !myPlayer) return;

    setError("");

    try {
      const data = await request(
        `/rooms/${room.code}/ready`,
        {
          method: "PATCH",
          headers: {
            "X-Session-Token": sessionToken,
          },
          body: JSON.stringify({
            ready: !myPlayer.ready,
          }),
        }
      );

      setRoom(data.room);
    } catch (err) {
      setError(err.message);
    }
  }

  // ----------------------------------------------------------
  // START DON'T TRUST THE FLOOR
  // ----------------------------------------------------------

  async function startGame() {
    if (!room || !sessionToken) return;

    setLoading(true);
    setError("");

    try {
      const data = await request(
        `/rooms/${room.code}/floor/start`,
        {
          method: "POST",
          headers: {
            "X-Session-Token": sessionToken,
          },
        }
      );

      setRoom(data.room);
      setSelectedTile(null);
      setSubmittingTile(false);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  // ----------------------------------------------------------
  // SELECT A TILE
  // ----------------------------------------------------------

  async function chooseTile(color) {
    if (!canChooseTile || !room || !sessionToken) return;

    setSelectedTile(color);
    setSubmittingTile(true);
    setError("");

    try {
      const data = await request(
        `/rooms/${room.code}/floor/choose`,
        {
          method: "POST",
          headers: {
            "X-Session-Token": sessionToken,
          },
          body: JSON.stringify({
            tile_color: color,
          }),
        }
      );

      setRoom(data.room);
    } catch (err) {
      setSelectedTile(null);
      setError(err.message);
    } finally {
      setSubmittingTile(false);
    }
  }

  // ----------------------------------------------------------
  // COPY INVITE
  // ----------------------------------------------------------

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

  // ----------------------------------------------------------
  // LEAVE ROOM
  // ----------------------------------------------------------

  function backToHome() {
    setRoom(null);
    setPlayerId("");
    setSessionToken("");
    setError("");
    setSelectedTile(null);
    setSubmittingTile(false);

    sessionStorage.removeItem("quizPlayerId");
    sessionStorage.removeItem("quizSessionToken");
    sessionStorage.removeItem("quizRoomCode");

    window.history.pushState({}, "", "/");
  }

  // ----------------------------------------------------------
  // RENDER
  // ----------------------------------------------------------

  return (
    <div className="app floor-app">
      <nav className="navbar">
        <div className="brand">
          <span className="brand-icon">🟩</span>
          DON'T TRUST THE FLOOR
        </div>

        <span className="nav-tag">MULTIPLAYER PARTY GAME</span>
      </nav>

      {!room ? (
        <main className="hero">
          <div className="hero-badge">
            🎭 TRUST NOTHING. PICK WISELY.
          </div>

          <h1>
            Don't trust
            <br />
            <span>the floor.</span>
          </h1>

          <p className="hero-description">
            Four colors. Hidden danger. One wrong move can
            change everything. Challenge your friends in a
            multiplayer survival showdown.
          </p>

          <section className="game-card">
            <label htmlFor="nickname">YOUR NICKNAME</label>

            <input
              id="nickname"
              value={nickname}
              onChange={(event) => setNickname(event.target.value)}
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

            <div className="or-divider">
              <span>OR JOIN A ROOM</span>
            </div>

            <label htmlFor="room-code">ROOM CODE</label>

            <div className="join-row">
              <input
                id="room-code"
                value={roomCode}
                onChange={(event) =>
                  setRoomCode(event.target.value.toUpperCase())
                }
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
            <span>🎨 Four colored tiles</span>
            <span>⚡ 10 suspenseful rounds</span>
          </div>

          <div className="landing-tiles" aria-hidden="true">
            {COLORS.map((color) => (
              <div
                key={color}
                className={`floor-tile floor-${color}`}
              >
                {COLOR_EMOJI[color]}
              </div>
            ))}
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
                ? "● FLOOR ACTIVE"
                : "● GAME OVER"}
            </span>
          </div>

          {/* WAITING ROOM */}

          {room.status === "lobby" && (
            <>
              <div className="lobby-title">
                <div className="hero-badge">
                  GET YOUR CREW TOGETHER
                </div>

                <h1>
                  Trust your
                  <br />
                  <span>instincts.</span>
                </h1>

                <p>
                  Invite your friends. Pick your colors. Survive the floor.
                </p>
              </div>

              <section className="lobby-card">
                <div className="room-code-heading">
                  <div>
                    <label>ROOM CODE</label>
                    <div className="room-code">{room.code}</div>
                  </div>

                  <button
                    className="secondary-button"
                    onClick={copyInvite}
                  >
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

                        <span>
                          {player.is_host
                            ? "Room host"
                            : `Player ${index + 1}`}
                        </span>
                      </div>

                      <span
                        className={`player-status ${
                          player.ready ? "ready" : "not-ready"
                        }`}
                      >
                        {player.ready ? "✓ Ready" : "Not ready"}
                      </span>
                    </div>
                  ))}
                </div>

                <button
                  className={`primary-button ready-button ${
                    myPlayer?.ready ? "is-ready" : ""
                  }`}
                  onClick={toggleReady}
                  disabled={!myPlayer}
                >
                  {myPlayer?.ready
                    ? "✓ Ready — Click to Cancel"
                    : "I'm Ready"}
                </button>

                {isHost ? (
                  <button
                    className="start-button"
                    onClick={startGame}
                    disabled={!canStart || loading}
                  >
                    {!everyoneReady
                      ? room.players.length < 2
                        ? "Need at Least 2 Players"
                        : "Waiting for Everyone"
                      : loading
                      ? "Starting..."
                      : "🎮 Start DON'T TRUST THE FLOOR"}
                  </button>
                ) : (
                  <p className="waiting-note">
                    The host will start when everyone is ready.
                  </p>
                )}

                <div className="rules-preview">
                  <h3>How to survive</h3>
                  <p>🎨 Pick one of four colored tiles.</p>
                  <p>⏱ You have 15 seconds to commit.</p>
                  <p>🎭 Some announcements are traps.</p>
                  <p>🏆 Safe tiles score +100. Danger costs 25.</p>
                </div>
              </section>
            </>
          )}

          {/* ACTIVE TILE GAME */}

          {room.status === "playing" && isFloorGame && floorGame && (
            <section className="floor-game-card">
              <div className="floor-round-heading">
                <div>
                  <span className="eyebrow">ROUND</span>
                  <h1>
                    {floorGame.round_number}
                    <span> / {floorGame.total_rounds}</span>
                  </h1>
                </div>

                {floorGame.phase === "choosing" ? (
                  <div
                    className={`floor-countdown ${
                      floorGame.remaining_seconds <= 5 ? "urgent" : ""
                    }`}
                  >
                    <span>TIME LEFT</span>
                    <strong>{floorGame.remaining_seconds}s</strong>
                  </div>
                ) : (
                  <div className="reveal-badge">
                    ✨ REVEAL
                  </div>
                )}
              </div>

              <div className="timer-track">
                <div
                  className="timer-fill"
                  style={{
                    width: `${
                      floorGame.phase === "choosing"
                        ? (floorGame.remaining_seconds /
                            floorGame.time_limit) *
                          100
                        : 0
                    }%`,
                  }}
                />
              </div>

              {floorGame.phase === "choosing" ? (
                <>
                  <div className="floor-announcement">
                    <span className="eyebrow">THE FLOOR SAYS...</span>

                    <h2>{floorGame.announcement}</h2>

                    <p>
                      Is it telling the truth? Lock in your tile.
                    </p>
                  </div>

                  <div className="tile-grid">
                    {floorGame.tiles.map((color) => (
                      <button
                        key={color}
                        className={`floor-tile floor-${color} ${
                          selectedTile === color ? "tile-selected" : ""
                        }`}
                        onClick={() => chooseTile(color)}
                        disabled={!canChooseTile}
                        aria-label={`Choose ${color} tile`}
                      >
                        <span className="tile-emoji">
                          {COLOR_EMOJI[color]}
                        </span>

                        <span className="tile-name">
                          {color.toUpperCase()}
                        </span>

                        {selectedTile === color && (
                          <span className="tile-check">✓ LOCKED</span>
                        )}
                      </button>
                    ))}
                  </div>

                  {alreadySelected || selectedTile ? (
                    <div className="floor-status-message">
                      <span className="status-pulse" />
                      Tile locked in! Waiting for the other players...
                    </div>
                  ) : (
                    <p className="floor-hint">
                      Choose carefully. You cannot change your choice.
                    </p>
                  )}

                  <div className="commit-progress">
                    <span>PLAYERS LOCKED IN</span>
                    <strong>
                      {floorGame.selected_player_ids.length}/
                      {room.players.length}
                    </strong>
                  </div>

                  <div className="commit-avatars">
                    {room.players.map((player) => {
                      const locked =
                        floorGame.selected_player_ids.includes(player.id);

                      return (
                        <div
                          key={player.id}
                          className={`commit-player ${
                            locked ? "committed" : ""
                          }`}
                          title={player.nickname}
                        >
                          <span>
                            {locked ? "✓" : "…"}
                          </span>
                          {player.nickname}
                          {player.id === playerId ? " (You)" : ""}
                        </div>
                      );
                    })}
                  </div>
                </>
              ) : (
                <>
                  <div className="floor-reveal-banner">
                    <span className="eyebrow">THE TRUTH IS REVEALED</span>
                    <h2>
                      {floorGame.safe_color?.toUpperCase()} WAS SAFE!
                    </h2>

                    {floorGame.is_trap ? (
                      <p>🎭 It was a trap! The announcement lied.</p>
                    ) : (
                      <p>✅ The announcement told the truth.</p>
                    )}
                  </div>

                  <div className="tile-grid reveal-grid">
                    {floorGame.tiles.map((color) => (
                      <div
                        key={color}
                        className={`floor-tile floor-${color} ${
                          color === floorGame.safe_color
                            ? "tile-safe"
                            : "tile-danger"
                        }`}
                      >
                        <span className="tile-emoji">
                          {COLOR_EMOJI[color]}
                        </span>

                        <span className="tile-name">
                          {color.toUpperCase()}
                        </span>

                        <span className="tile-result">
                          {color === floorGame.safe_color
                            ? "✓ SAFE"
                            : "✕ DANGER"}
                        </span>
                      </div>
                    ))}
                  </div>

                  <div className="round-results">
                    <h2>Round results</h2>

                    {(floorGame.results || []).map((result) => (
                      <div
                        className="round-result-row"
                        key={result.player_id}
                      >
                        <div className="player-info">
                          <strong>
                            {result.nickname}
                            {result.player_id === playerId
                              ? " (You)"
                              : ""}
                          </strong>

                          <span>
                            {result.outcome === "safe"
                              ? `Survived on ${result.tile_color}`
                              : result.outcome === "danger"
                              ? `Dangerous ${result.tile_color} tile`
                              : "Didn't choose in time"}
                          </span>
                        </div>

                        <strong
                          className={
                            result.points_earned > 0
                              ? "points-positive"
                              : result.points_earned < 0
                              ? "points-negative"
                              : ""
                          }
                        >
                          {result.points_earned > 0 ? "+" : ""}
                          {result.points_earned}
                        </strong>
                      </div>
                    ))}
                  </div>

                  <p className="waiting-note">
                    Next round starting soon...
                  </p>
                </>
              )}

              <div className="live-scoreboard">
                <h2>Live leaderboard</h2>

                {[...room.players]
                  .sort((a, b) => b.score - a.score)
                  .map((player, index) => (
                    <div className="score-row" key={player.id}>
                      <span>
                        {index + 1}. {player.nickname}
                        {player.id === playerId ? " (You)" : ""}
                      </span>

                      <strong>{player.score} pts</strong>
                    </div>
                  ))}
              </div>

              {error && <p className="error-message">{error}</p>}
            </section>
          )}

          {/* FINAL RESULTS */}

          {room.status === "completed" && (
            <section className="lobby-card results-card">
              <div className="hero-badge">
                🏆 THE FLOOR HAS SPOKEN
              </div>

              <h1 className="results-title">
                Last one
                <br />
                <span>standing.</span>
              </h1>

              <p className="hero-description">
                All {room.total_rounds || 10} rounds are complete.
                Here are the final scores.
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
                          {player.nickname}
                          {player.id === playerId ? " (You)" : ""}
                        </strong>

                        <span>
                          {index === 0
                            ? "Floor champion"
                            : "Floor survivor"}
                        </span>
                      </div>

                      <strong>{player.score} pts</strong>
                    </div>
                  ))}
              </div>

              <button
                className="primary-button"
                onClick={backToHome}
              >
                Play Again
              </button>

              <p className="waiting-note">
                Return home and create a new room to play another game.
              </p>
            </section>
          )}

          {error && room.status === "lobby" && (
            <p className="error-message">{error}</p>
          )}

          <button
            className="text-button refresh-button"
            onClick={refreshRoom}
          >
            ↻ Refresh room
          </button>
        </main>
      )}

      <footer className="footer">
        DON'T TRUST THE FLOOR <span>•</span> TRUST YOUR INSTINCTS
      </footer>
    </div>
  );
}

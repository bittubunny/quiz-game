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
  hidden: "❓",
};

const QUICK_REACTIONS = [
  { emoji: "🔥", text: "Trust me! This tile is safe." },
  { emoji: "💀", text: "You're walking into a trap!" },
  { emoji: "🤫", text: "Keep it quiet, I know the truth." },
  { emoji: "😂", text: "Good luck dying there!" },
];

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
  const [selectedTileId, setSelectedTileId] = useState(null);
  const [submittingTile, setSubmittingTile] = useState(false);

  // Social & Deception UI states
  const [showRules, setShowRules] = useState(false);
  const [betrayalTarget, setBetrayalTarget] = useState("");
  const [betrayalMessage, setBetrayalMessage] = useState("");
  const [betrayalSuccess, setBetrayalSuccess] = useState("");
  const [auctionBidInput, setAuctionBidInput] = useState("");
  const [auctionSubmitted, setAuctionSubmitted] = useState(false);

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
    selectedTileId === null &&
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
    setSelectedTileId(null);
    setSubmittingTile(false);
    setAuctionSubmitted(false);

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
    if (!room?.code || !sessionToken) return;

    try {
      const data = await request(`/rooms/${room.code}`, {
        headers: {
          "X-Session-Token": sessionToken,
        },
      });

      setRoom((previous) => {
        if (
          previous?.question_number !== data.question_number ||
          previous?.status !== data.status ||
          previous?.floor_game?.round_number !==
            data.floor_game?.round_number ||
          previous?.floor_game?.phase !==
            data.floor_game?.phase
        ) {
          setSelectedTileId(null);
          setSubmittingTile(false);
          setAuctionSubmitted(false);
        }

        return data;
      });

      setError("");
    } catch (err) {
      setError(err.message);
    }
  }, [room?.code, sessionToken]);

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
        const data = await request(`/rooms/${savedCode}`, {
          headers: {
            "X-Session-Token": savedToken,
          },
        });

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
      setSelectedTileId(null);
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

  async function chooseTile(tileId) {
    if (!canChooseTile || !room || !sessionToken) return;

    setSelectedTileId(tileId);
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
            tile_id: tileId,
          }),
        }
      );

      setRoom(data.room);
    } catch (err) {
      setSelectedTileId(null);
      setError(err.message);
    } finally {
      setSubmittingTile(false);
    }
  }

  // ----------------------------------------------------------
  // SOCIAL ACTIONS (Reactions, Betrayal, Auction)
  // ----------------------------------------------------------

  async function sendReaction(emoji, text) {
    if (!room || !sessionToken) return;
    try {
      const data = await request(`/rooms/${room.code}/floor/react`, {
        method: "POST",
        headers: { "X-Session-Token": sessionToken },
        body: JSON.stringify({ emoji, text }),
      });
      setRoom(data.room);
    } catch (err) {
      setError(err.message);
    }
  }

  async function sendBetrayal(e) {
    e.preventDefault();
    if (!room || !sessionToken || !betrayalTarget || !betrayalMessage) return;
    setError("");
    setBetrayalSuccess("");

    try {
      const data = await request(`/rooms/${room.code}/floor/betray`, {
        method: "POST",
        headers: { "X-Session-Token": sessionToken },
        body: JSON.stringify({
          target_player_id: betrayalTarget,
          message: betrayalMessage,
        }),
      });
      setRoom(data.room);
      setBetrayalMessage("");
      setBetrayalSuccess("Secret message successfully dispatched!");
      setTimeout(() => setBetrayalSuccess(""), 3000);
    } catch (err) {
      setError(err.message);
    }
  }

  async function submitAuctionBid(e) {
    e.preventDefault();
    if (!room || !sessionToken) return;
    const amount = parseInt(auctionBidInput, 10);
    if (isNaN(amount) || amount < 0) {
      setError("Please enter a valid bid amount.");
      return;
    }
    setError("");

    try {
      const data = await request(`/rooms/${room.code}/floor/auction`, {
        method: "POST",
        headers: { "X-Session-Token": sessionToken },
        body: JSON.stringify({ bid_amount: amount }),
      });
      setRoom(data.room);
      setAuctionSubmitted(true);
    } catch (err) {
      setError(err.message);
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
    setSelectedTileId(null);
    setSubmittingTile(false);
    setAuctionSubmitted(false);

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

        <button
          className="secondary-button rules-toggle-btn"
          onClick={() => setShowRules(true)}
          style={{ padding: "8px 12px", fontSize: "11px" }}
        >
          📜 How to Play & Rules
        </button>
      </nav>

      {/* RULES MODAL */}
      {showRules && (
        <div className="rules-modal-overlay">
          <div className="rules-modal">
            <h2>📜 Game Rules & Deception Mechanics</h2>
            <div className="rules-content">
              <h3>1. The Core Objective</h3>
              <p>Survive 10 grueling rounds across a dynamic grid of tiles. Correct safe tiles reward points (+100 or more), while dangerous tiles or traps penalize your score (-25).</p>
              
              <h3>2. Bluffing & False Announcements</h3>
              <p>The game announces clues like <em>“BLUE looks safe.”</em> But beware! Announcements can be completely false or trap-laden. Use quick reactions to mislead or reassure your rivals.</p>

              <h3>3. The Secret Informant</h3>
              <p>Each round, one random player secretly receives a private mission or clue. Complete your secret objective or use the knowledge to manipulate the room without anyone knowing!</p>

              <h3>4. The Betrayal Button</h3>
              <p>Once per match, every player can send a fake private warning to a specific opponent (e.g., <em>“RED is definitely safe.”</em>). If they fall for it and fail, you steal bonus points!</p>

              <h3>5. Fragmented Clues & Final Truth Auction</h3>
              <p>Nobody gets the whole truth—every player receives a different clue fragment. In the final round, bid your hard-earned points to buy the exact safe coordinate in a high-stakes blind auction!</p>
            </div>
            <button
              className="primary-button"
              onClick={() => setShowRules(false)}
              style={{ marginTop: "20px" }}
            >
              Got it, let's play!
            </button>
          </div>
        </div>
      )}

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
            Four colors. Hidden danger. Deception, secret missions,
            and backstabbing await in this multiplayer survival showdown.
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
            <span>🕵️ Secret Informants & Betrayals</span>
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
                  Invite your friends. Pick your tiles. Survive the floor.
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
                  <h3>Social Deception Active</h3>
                  <p>🕵️ Secret missions & private information fragments assigned every round.</p>
                  <p>🗡️ One-time Betrayal Button available to send fake messages.</p>
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

              {/* Event banner */}
              {floorGame.event && (
                <div className="event-banner" style={{ margin: "1rem 0", padding: "0.6rem 1rem", background: "rgba(255,255,255,0.05)", borderRadius: "8px", border: "1px solid rgba(255,255,255,0.1)" }}>
                  <span style={{ fontSize: "0.75rem", color: "#a0aec0", display: "block" }}>EVENT: {floorGame.event.name.toUpperCase()}</span>
                  <span style={{ fontSize: "0.9rem", fontWeight: "600" }}>{floorGame.event.description}</span>
                </div>
              )}

              {/* PRIVATE ROLES & CLUES PANEL */}
              <div className="private-info-panel" style={{ margin: "1rem 0", padding: "12px", background: "rgba(149, 107, 255, 0.08)", borderRadius: "10px", border: "1px solid rgba(149, 107, 255, 0.2)" }}>
                <h4 style={{ margin: "0 0 6px 0", fontSize: "11px", color: "#c4b5fd", letterSpacing: "1px" }}>🔒 PRIVATE INTEL & FRAGMENT</h4>
                <p style={{ margin: "4px 0", fontSize: "12px" }}><strong>Clue Fragment:</strong> {floorGame.my_fragment || "None received."}</p>
                {floorGame.secret_mission && (
                  <p style={{ margin: "4px 0", fontSize: "12px", color: "#ffd166" }}><strong>🕵️ Secret Mission:</strong> {floorGame.secret_mission}</p>
                )}
                {floorGame.auction_hint && (
                  <p style={{ margin: "4px 0", fontSize: "12px", color: "#5ee6a8" }}><strong>💎 Auction Hint:</strong> {floorGame.auction_hint}</p>
                )}
              </div>

              {/* INBOX (Anonymous Betrayal Warnings) */}
              {floorGame.inbox && floorGame.inbox.length > 0 && (
                <div className="inbox-panel" style={{ margin: "1rem 0", padding: "10px", background: "rgba(255, 119, 127, 0.1)", borderRadius: "8px", border: "1px solid rgba(255, 119, 127, 0.3)" }}>
                  <h4 style={{ margin: "0 0 4px 0", fontSize: "11px", color: "#ff777f" }}>📥 ANONYMOUS WARNING INBOX</h4>
                  {floorGame.inbox.map((msg, idx) => (
                    <p key={idx} style={{ margin: "4px 0", fontSize: "12px" }}>💬 <em>"{msg.message}"</em></p>
                  ))}
                </div>
              )}

              {/* QUICK REACTIONS CHAT */}
              {floorGame.phase === "choosing" && (
                <div className="reactions-container" style={{ margin: "1rem 0" }}>
                  <div style={{ fontSize: "10px", color: "#aaa7bb", marginBottom: "6px", fontWeight: "700" }}>SEND QUICK REACTION / BLUFF:</div>
                  <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                    {QUICK_REACTIONS.map((item, idx) => (
                      <button
                        key={idx}
                        className="secondary-button"
                        style={{ fontSize: "11px", padding: "6px 10px" }}
                        onClick={() => sendReaction(item.emoji, item.text)}
                      >
                        {item.emoji} {item.text}
                      </button>
                    ))}
                  </div>

                  {/* Public Live Feed */}
                  {floorGame.reactions && floorGame.reactions.length > 0 && (
                    <div style={{ marginTop: "10px", maxHeight: "80px", overflowY: "auto", background: "rgba(0,0,0,0.3)", padding: "8px", borderRadius: "6px" }}>
                      {floorGame.reactions.slice(-3).map((r, i) => (
                        <div key={i} style={{ fontSize: "11px", margin: "2px 0", color: "#e2e8f0" }}>
                          <strong>{r.nickname}:</strong> {r.emoji} {r.text}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* BETRAYAL BUTTON WIDGET */}
              {floorGame.phase === "choosing" && myPlayer && !myPlayer.has_used_betrayal && (
                <div className="betrayal-widget" style={{ margin: "1rem 0", padding: "12px", background: "rgba(255,255,255,0.03)", borderRadius: "10px", border: "1px solid rgba(255,255,255,0.1)" }}>
                  <h4 style={{ margin: "0 0 8px 0", fontSize: "11px", color: "#ff777f" }}>🗡️ THE BETRAYAL BUTTON (1-Use per match)</h4>
                  <form onSubmit={sendBetrayal} style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                    <select
                      value={betrayalTarget}
                      onChange={(e) => setBetrayalTarget(e.target.value)}
                      style={{ background: "#09090f", color: "#fff", border: "1px solid rgba(255,255,255,0.2)", padding: "6px", borderRadius: "6px", fontSize: "11px" }}
                    >
                      <option value="">Select Target Opponent</option>
                      {room.players.filter(p => p.id !== playerId).map(p => (
                        <option key={p.id} value={p.id}>{p.nickname}</option>
                      ))}
                    </select>
                    <input
                      type="text"
                      placeholder="e.g. RED is completely safe!"
                      value={betrayalMessage}
                      onChange={(e) => setBetrayalMessage(e.target.value)}
                      maxLength={100}
                      style={{ flex: 1, minWidth: "150px", background: "#09090f", color: "#fff", border: "1px solid rgba(255,255,255,0.2)", padding: "6px 10px", borderRadius: "6px", fontSize: "11px" }}
                    />
                    <button type="submit" className="secondary-button" style={{ borderColor: "#ff777f", color: "#ff777f", fontSize: "11px" }}>Send Bluff</button>
                  </form>
                  {betrayalSuccess && <p style={{ color: "#5ee6a8", fontSize: "11px", margin: "4px 0 0 0" }}>{betrayalSuccess}</p>}
                </div>
              )}

              {/* FINAL ROUND TRUTH AUCTION */}
              {floorGame.is_final_round && floorGame.phase === "choosing" && (
                <div className="auction-widget" style={{ margin: "1rem 0", padding: "14px", background: "rgba(255, 209, 102, 0.08)", borderRadius: "10px", border: "1px solid rgba(255, 209, 102, 0.3)" }}>
                  <h4 style={{ margin: "0 0 6px 0", fontSize: "12px", color: "#ffd166" }}>💎 FINAL ROUND TRUTH AUCTION</h4>
                  <p style={{ margin: "0 0 8px 0", fontSize: "11px", color: "#aaa7bb" }}>Bid points to buy the exact safe coordinate hint. Highest bidder wins the intel!</p>
                  {!auctionSubmitted ? (
                    <form onSubmit={submitAuctionBid} style={{ display: "flex", gap: "8px" }}>
                      <input
                        type="number"
                        placeholder="Bid points"
                        value={auctionBidInput}
                        onChange={(e) => setAuctionBidInput(e.target.value)}
                        style={{ width: "120px", background: "#09090f", color: "#fff", border: "1px solid rgba(255,255,255,0.2)", padding: "6px 10px", borderRadius: "6px", fontSize: "11px" }}
                      />
                      <button type="submit" className="secondary-button" style={{ borderColor: "#ffd166", color: "#ffd166", fontSize: "11px" }}>Place Bid</button>
                    </form>
                  ) : (
                    <p style={{ color: "#ffd166", fontSize: "12px", margin: "0" }}>Bid submitted successfully! Awaiting round resolution...</p>
                  )}
                </div>
              )}

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

                  {/* Dynamic Grid Rendering */}
                  <div
                    className="tile-grid dynamic-grid"
                    style={{
                      gridTemplateColumns: `repeat(${floorGame.arena?.grid_size || 3}, minmax(0, 1fr))`,
                    }}
                  >
                    {floorGame.arena?.tiles.map((tile) => {
                      const isSelected = selectedTileId === tile.id;
                      const isInactive = !tile.active;

                      return (
                        <button
                          key={tile.id}
                          className={`floor-tile floor-${tile.color} ${
                            isSelected ? "tile-selected" : ""
                          } ${isInactive ? "tile-inactive" : ""}`}
                          onClick={() => chooseTile(tile.id)}
                          disabled={!canChooseTile || isInactive}
                          aria-label={`Choose tile at row ${tile.row + 1}, column ${tile.column + 1}`}
                        >
                          <span className="tile-emoji">
                            {COLOR_EMOJI[tile.color] || "🟩"}
                          </span>

                          <span className="tile-name">
                            {tile.color.toUpperCase()}
                          </span>

                          {isSelected && (
                            <span className="tile-check">✓ LOCKED</span>
                          )}

                          {isInactive && (
                            <span className="tile-inactive-label">INACTIVE</span>
                          )}
                        </button>
                      );
                    })}
                  </div>

                  {alreadySelected || selectedTileId ? (
                    <div className="floor-status-message">
                      <span className="status-pulse" />
                      Tile locked in! Waiting for the other players...
                    </div>
                  ) : (
                    <p className="floor-hint">
                      Choose carefully from the active arena. You cannot change your choice.
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

                  <div
                    className="tile-grid reveal-grid dynamic-grid"
                    style={{
                      gridTemplateColumns: `repeat(${floorGame.arena?.grid_size || 3}, minmax(0, 1fr))`,
                    }}
                  >
                    {floorGame.arena?.tiles.map((tile) => {
                      const isSafe = tile.outcome === "safe" || tile.outcome === "bonus";

                      return (
                        <div
                          key={tile.id}
                          className={`floor-tile floor-${tile.color} ${
                            isSafe ? "tile-safe" : "tile-danger"
                          }`}
                        >
                          <span className="tile-emoji">
                            {COLOR_EMOJI[tile.color] || "🟩"}
                          </span>

                          <span className="tile-name">
                            {tile.color.toUpperCase()}
                          </span>

                          <span className="tile-result">
                            {tile.outcome === "bonus"
                              ? "⭐ BONUS"
                              : tile.outcome === "safe"
                              ? "✓ SAFE"
                              : tile.outcome === "trap"
                              ? "⚠️ TRAP"
                              : "✕ DANGER"}
                          </span>
                        </div>
                      );
                    })}
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
                            {result.outcome === "safe" || result.outcome === "bonus"
                              ? `Survived on ${result.tile_color}`
                              : result.outcome === "danger" || result.outcome === "trap"
                              ? `Dangerous/Trap tile (${result.tile_color || "none"})`
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

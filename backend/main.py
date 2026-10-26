import secrets
import string
import time
from datetime import datetime, timezone
from typing import Optional

from fastapi import FastAPI, HTTPException, Header
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field, model_validator


app = FastAPI(title="DON'T TRUST THE FLOOR API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "https://quiz-game-ten-khaki.vercel.app",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ============================================================
# CONFIGURATION
# ============================================================

MAX_PLAYERS = 4

QUESTION_TIME = 15
TOTAL_QUESTIONS = 10

FLOOR_COLORS = ["green", "blue", "red", "yellow"]
FLOOR_ROUNDS = 10
FLOOR_DECISION_TIME = 45
FLOOR_REVEAL_TIME = 8
FLOOR_SAFE_POINTS = 100
FLOOR_DANGER_PENALTY = 25
FLOOR_TRAP_CHANCE = 30
FLOOR_BONUS_POINTS = 150
FLOOR_DOUBLE_POINTS = 2
FLOOR_MIN_GRID_SIZE = 3
FLOOR_MAX_GRID_SIZE = 4
FLOOR_SPECIAL_TILE_CHANCE = 20

rooms = {}

# ============================================================
# ORIGINAL QUIZ QUESTIONS
# ============================================================

QUESTIONS = [
    {
        "question": "Which language is primarily used to build React applications?",
        "options": ["Python", "JavaScript", "C", "SQL"],
        "correct": 1,
        "explanation": "React is a JavaScript library for building user interfaces.",
    },
    {
        "question": "What is the time complexity of binary search on a sorted array?",
        "options": ["O(n)", "O(n²)", "O(log n)", "O(1) always"],
        "correct": 2,
        "explanation": "Binary search halves the search range at each step.",
    },
    {
        "question": "Which data structure follows FIFO order?",
        "options": ["Stack", "Queue", "Tree", "Graph"],
        "correct": 1,
        "explanation": "FIFO means First In, First Out, which is how a queue works.",
    },
    {
        "question": "What does SQL stand for?",
        "options": [
            "Structured Query Language",
            "Simple Question Logic",
            "Sequential Queue Language",
            "System Quality Link",
        ],
        "correct": 0,
        "explanation": "SQL stands for Structured Query Language.",
    },
    {
        "question": "Which component executes instructions in a computer?",
        "options": ["Monitor", "CPU", "Keyboard", "Printer"],
        "correct": 1,
        "explanation": "The CPU executes program instructions.",
    },
    {
        "question": "Which HTTP status code usually means a successful request?",
        "options": ["404", "500", "200", "301"],
        "correct": 2,
        "explanation": "HTTP 200 indicates success.",
    },
    {
        "question": "Which keyword defines a function in Python?",
        "options": ["func", "define", "def", "function"],
        "correct": 2,
        "explanation": "Python functions are defined using the def keyword.",
    },
    {
        "question": "Which of these is a relational database?",
        "options": ["PostgreSQL", "HTML", "CSS", "React"],
        "correct": 0,
        "explanation": "PostgreSQL is a relational database management system.",
    },
    {
        "question": "What does API commonly stand for?",
        "options": [
            "Application Programming Interface",
            "Automated Program Internet",
            "Applied Processing Input",
            "Application Page Index",
        ],
        "correct": 0,
        "explanation": "An API defines how software components communicate.",
    },
    {
        "question": "Which protocol is commonly used to securely browse websites?",
        "options": ["FTP", "HTTP only", "HTTPS", "SMTP"],
        "correct": 2,
        "explanation": "HTTPS secures web traffic using TLS.",
    },
]

# ============================================================
# REQUEST MODELS
# ============================================================

class NicknameRequest(BaseModel):
    nickname: str = Field(min_length=1, max_length=20)


class ReadyRequest(BaseModel):
    ready: bool


class AnswerRequest(BaseModel):
    answer_index: int = Field(ge=0, le=3)


class FloorChoiceRequest(BaseModel):
    tile_color: Optional[str] = None
    tile_id: Optional[str] = None

    @model_validator(mode="after")
    def require_a_tile_choice(self):
        if not self.tile_color and not self.tile_id:
            raise ValueError("Provide either tile_id or tile_color.")
        return self


class BetrayalRequest(BaseModel):
    target_player_id: str
    message: str = Field(min_length=1, max_length=100)


class AuctionBidRequest(BaseModel):
    bid_amount: int = Field(ge=0)


# ============================================================
# COMMON HELPERS
# ============================================================

def clean_nickname(nickname: str) -> str:
    nickname = " ".join(nickname.split()).strip()
    if not nickname:
        raise HTTPException(
            status_code=400,
            detail="Enter a nickname.",
        )
    return nickname[:20]


def generate_room_code() -> str:
    characters = string.ascii_uppercase + string.digits
    while True:
        code = "".join(secrets.choice(characters) for _ in range(6))
        if code not in rooms:
            return code


def get_room_or_404(code: str) -> dict:
    room = rooms.get(code.strip().upper())
    if not room:
        raise HTTPException(
            status_code=404,
            detail="Room not found.",
        )
    advance_game_if_needed(room)
    return room


def authenticate_player(
    room: dict,
    session_token: Optional[str],
) -> dict:
    if not session_token:
        raise HTTPException(
            status_code=401,
            detail="Session token missing.",
        )

    for player in room["players"]:
        if secrets.compare_digest(player["session_token"], session_token):
            return player

    raise HTTPException(
        status_code=401,
        detail="Invalid session token.",
    )


# ============================================================
# DON'T TRUST THE FLOOR: DYNAMIC ARENA & DECEPTION ENGINE
# ============================================================

FLOOR_EVENTS = [
    {
        "id": "color_clue",
        "name": "Trust Issues",
        "description": "A color is announced. It might be telling the truth.",
    },
    {
        "id": "fake_clue",
        "name": "False Promise",
        "description": "The announcement is guaranteed to be misleading this round.",
    },
    {
        "id": "bonus_tile",
        "name": "Golden Opportunity",
        "description": "A hidden bonus tile can award extra points.",
    },
    {
        "id": "trap_tiles",
        "name": "Trap Floor",
        "description": "Some tiles are dangerous even when the clue seems convincing.",
    },
    {
        "id": "shrinking_arena",
        "name": "Shrinking Arena",
        "description": "Only the highlighted active area can be selected.",
    },
    {
        "id": "blackout",
        "name": "Color Blackout",
        "description": "Tile colors are hidden; use the tile positions and clue carefully.",
    },
    {
        "id": "double_points",
        "name": "Double or Nothing",
        "description": "Safe tiles award double points this round.",
    },
]


def choose_floor_event() -> dict:
    return dict(secrets.choice(FLOOR_EVENTS))


def create_floor_round(round_number: int, total_rounds: int, players: list) -> dict:
    grid_size = secrets.choice([FLOOR_MIN_GRID_SIZE, FLOOR_MAX_GRID_SIZE])
    event = choose_floor_event()

    announced_color = secrets.choice(FLOOR_COLORS)
    forced_fake_clue = event["id"] == "fake_clue"
    is_trap_clue = forced_fake_clue or (
        secrets.randbelow(100) < FLOOR_TRAP_CHANCE
    )

    if is_trap_clue:
        safe_color = secrets.choice([
            color for color in FLOOR_COLORS if color != announced_color
        ])
    else:
        safe_color = announced_color

    tiles = []
    safe_tile_ids = []
    tile_outcomes = {}

    active_size = grid_size
    if event["id"] == "shrinking_arena" and grid_size == 4:
        active_size = 3

    for row in range(grid_size):
        for column in range(grid_size):
            tile_id = f"r{row + 1}c{column + 1}"
            color = secrets.choice(FLOOR_COLORS)
            active = row < active_size and column < active_size

            if color == safe_color:
                outcome = "safe"
            else:
                outcome = "danger"

            if active and color != safe_color:
                if secrets.randbelow(100) < FLOOR_SPECIAL_TILE_CHANCE:
                    outcome = "trap"

            tiles.append({
                "id": tile_id,
                "color": color,
                "row": row,
                "column": column,
                "active": active,
            })
            tile_outcomes[tile_id] = outcome

            if active and outcome == "safe":
                safe_tile_ids.append(tile_id)

    if not safe_tile_ids:
        candidates = [tile for tile in tiles if tile["active"]]
        chosen = secrets.choice(candidates)
        chosen["color"] = safe_color
        tile_outcomes[chosen["id"]] = "safe"
        safe_tile_ids.append(chosen["id"])

    bonus_tile_id = None
    if event["id"] == "bonus_tile":
        bonus_candidates = [tile_id for tile_id in safe_tile_ids]
        if bonus_candidates:
            bonus_tile_id = secrets.choice(bonus_candidates)
            tile_outcomes[bonus_tile_id] = "bonus"

    announcement = f"{announced_color.upper()} IS SAFE!"
    if event["id"] == "blackout":
        announcement = "BLACKOUT! THE COLORS WON'T SAVE YOU."

    # --- NEW FEATURE LOGIC ---
    # 1. Assign Secret Informant to one random player per round
    informant_player = secrets.choice(players) if players else None
    informant_secret = None
    if informant_player:
        # Generate custom secret mission/clue
        secret_types = [
            f"{safe_color.upper()} is safe. Convince others to pick it for bonus points!",
            f"A danger zone lurks near {announced_color.upper()}. Mislead your opponents!",
            f"At least one trap tile is active this round. Steer everyone away from it, or into it!",
        ]
        informant_secret = secrets.choice(secret_types)

    # 2. Assign Fragmented Info to all players ("Nobody Gets the Whole Truth")
    fragment_pool = [
        f"Safe color contains or matches {safe_color}.",
        "At least one danger tile is a hidden trap.",
        "The current announcement might be fully deceptive.",
        "The safest tile on this board contains a high-value bonus.",
        "Check row positions carefully; edge coordinates hide traps.",
    ]
    player_fragments = {}
    for p in players:
        player_fragments[p["id"]] = secrets.choice(fragment_pool)

    # 3. Final Round Auction initialization
    is_final_round = (round_number == total_rounds)

    return {
        "round_number": round_number,
        "grid_size": grid_size,
        "active_size": active_size,
        "event": event,
        "announcement": announcement,
        "announced_color": announced_color,
        "safe_color": safe_color,
        "is_trap": is_trap_clue,
        "tiles": tiles,
        "tile_outcomes": tile_outcomes,
        "safe_tile_ids": safe_tile_ids,
        "bonus_tile_id": bonus_tile_id,
        "double_points": event["id"] == "double_points",
        "blackout": event["id"] == "blackout",
        "informant_player_id": informant_player["id"] if informant_player else None,
        "informant_secret": informant_secret,
        "player_fragments": player_fragments,
        "is_final_round": is_final_round,
        "auction_bids": {},  # player_id -> bid amount
        "auction_resolved": False,
        "auction_hints": {},  # player_id -> hint text
    }


def resolve_floor_round(room: dict) -> None:
    game = room["floor_game"]

    if game["phase"] != "choosing":
        return

    round_data = game["rounds"][game["round_index"]]
    results = []

    # Resolve Final Round Auction if applicable
    if round_data["is_final_round"] and not round_data["auction_resolved"]:
        round_data["auction_resolved"] = True
        bids = round_data["auction_bids"]
        if bids:
            # Find highest bidder
            highest_bidder_id = max(bids, key=bids.get)
            max_bid = bids[highest_bidder_id]
            # Deduct points from highest bidder
            for p in room["players"]:
                if p["id"] == highest_bidder_id:
                    p["score"] = max(0, p["score"] - max_bid)
                    # Give private exact hint
                    round_data["auction_hints"][p["id"]] = f"AUCTION WIN: Safe color is {round_data['safe_color'].upper()}!"
                    break

    for player in room["players"]:
        choice = game["choices"].get(player["id"])

        if choice is None:
            outcome = "timeout"
            points = 0
            chosen_tile_id = None
            chosen_color = None
        else:
            chosen_tile_id = choice["tile_id"]
            chosen_color = choice["tile_color"]
            tile_outcome = round_data["tile_outcomes"].get(chosen_tile_id, "danger")

            if tile_outcome in ("safe", "bonus"):
                outcome = tile_outcome
                points = FLOOR_SAFE_POINTS

                if round_data["double_points"]:
                    points *= FLOOR_DOUBLE_POINTS

                if tile_outcome == "bonus":
                    points += FLOOR_BONUS_POINTS

                player["score"] += points
            else:
                outcome = tile_outcome
                points = -FLOOR_DANGER_PENALTY
                player["score"] += points

        # Check Betrayal outcome points settlement
        # If player was targeted by a betrayal and failed, sender gets bonus
        betrayals = game.get("betrayals", {})
        for sender_id, target_data in betrayals.items():
            if target_data.get("target_id") == player["id"] and not target_data.get("settled"):
                target_data["settled"] = True
                if outcome in ("danger", "trap", "timeout"):
                    # Target failed! Reward sender
                    for p in room["players"]:
                        if p["id"] == sender_id:
                            p["score"] += 75  # Bonus reward for successful betrayal
                            break

        results.append({
            "player_id": player["id"],
            "nickname": player["nickname"],
            "tile_id": chosen_tile_id,
            "tile_color": chosen_color,
            "outcome": outcome,
            "points_earned": points,
            "total_score": player["score"],
        })

    game["results"] = results
    game["phase"] = "reveal"
    game["phase_started_at"] = time.time()


def advance_floor_game_if_needed(room: dict) -> None:
    game = room.get("floor_game")

    if not game or room["status"] != "playing":
        return

    now = time.time()

    if game["phase"] == "choosing":
        elapsed = now - game["phase_started_at"]
        everyone_chose = len(game["choices"]) >= len(room["players"])

        if everyone_chose or elapsed >= FLOOR_DECISION_TIME:
            resolve_floor_round(room)

    elif game["phase"] == "reveal":
        elapsed = now - game["phase_started_at"]

        if elapsed >= FLOOR_REVEAL_TIME:
            next_index = game["round_index"] + 1

            if next_index >= FLOOR_ROUNDS:
                room["status"] = "completed"
                return

            game["round_index"] = next_index
            game["phase"] = "choosing"
            game["phase_started_at"] = now
            game["choices"] = {}
            game["results"] = []
            # Reset round specific ephemeral action states like chat reactions/betrayals flags if needed


def public_floor_tile(tile: dict, round_data: dict, reveal: bool) -> dict:
    result = {
        "id": tile["id"],
        "color": "hidden" if round_data["blackout"] and not reveal else tile["color"],
        "row": tile["row"],
        "column": tile["column"],
        "active": tile["active"],
    }

    if reveal:
        result["outcome"] = round_data["tile_outcomes"].get(tile["id"], "danger")

    return result


# ============================================================
# ORIGINAL QUIZ ENGINE
# ============================================================

def advance_quiz_if_needed(room: dict) -> None:
    if room["status"] != "playing":
        return

    elapsed = time.time() - room["question_started_at"]
    all_answered = len(room["answers"]) >= len(room["players"])

    if elapsed >= QUESTION_TIME or all_answered:
        next_index = room["question_index"] + 1

        if next_index >= len(room["questions"]):
            room["status"] = "completed"
            room["answers"] = {}
        else:
            room["question_index"] = next_index
            room["question_started_at"] = time.time()
            room["answers"] = {}


def advance_game_if_needed(room: dict) -> None:
    if room.get("game_mode") == "floor":
        advance_floor_game_if_needed(room)
    else:
        advance_quiz_if_needed(room)


# ============================================================
# PUBLIC ROOM STATE
# ============================================================

def public_room_state(room: dict, current_player_id: Optional[str] = None) -> dict:
    advance_game_if_needed(room)

    players = [
        {
            "id": player["id"],
            "nickname": player["nickname"],
            "is_host": player["is_host"],
            "ready": player["ready"],
            "score": player["score"],
            "has_used_betrayal": player.get("has_used_betrayal", False),
        }
        for player in room["players"]
    ]

    result = {
        "code": room["code"],
        "host_id": room["host_id"],
        "status": room["status"],
        "created_at": room["created_at"],
        "players": players,
        "game_mode": room.get("game_mode", "quiz"),
    }

    if room.get("game_mode") == "floor":
        game = room["floor_game"]

        result["question_number"] = game["round_index"] + 1
        result["total_questions"] = FLOOR_ROUNDS

        if room["status"] == "playing":
            round_data = game["rounds"][game["round_index"]]
            reveal = game["phase"] == "reveal"

            floor_state = {
                "round_number": game["round_index"] + 1,
                "total_rounds": FLOOR_ROUNDS,
                "phase": game["phase"],
                "time_limit": FLOOR_DECISION_TIME,
                "remaining_seconds": (
                    max(
                        0,
                        FLOOR_DECISION_TIME
                        - int(time.time() - game["phase_started_at"]),
                    )
                    if game["phase"] == "choosing"
                    else 0
                ),
                "announcement": round_data["announcement"],
                "tiles": FLOOR_COLORS,
                "arena": {
                    "grid_size": round_data["grid_size"],
                    "active_size": round_data["active_size"],
                    "tiles": [
                        public_floor_tile(tile, round_data, reveal)
                        for tile in round_data["tiles"]
                    ],
                },
                "event": round_data["event"],
                "double_points": round_data["double_points"],
                "blackout": round_data["blackout"],
                "selected_player_ids": list(game["choices"].keys()),
                "is_final_round": round_data["is_final_round"],
            }

            # Personal/Private payloads for the current authenticated client
            if current_player_id:
                # Secret Informant check
                if round_data["informant_player_id"] == current_player_id:
                    floor_state["secret_mission"] = round_data["informant_secret"]
                else:
                    floor_state["secret_mission"] = None

                # Fragmented clue
                floor_state["my_fragment"] = round_data["player_fragments"].get(current_player_id, "")

                # Incoming Betrayal messages
                inbox = game.get("inbox", {}).get(current_player_id, [])
                floor_state["inbox"] = inbox

                # Auction hint if won
                if round_data["auction_hints"].get(current_player_id):
                    floor_state["auction_hint"] = round_data["auction_hints"][current_player_id]

            # Public reactions feed
            floor_state["reactions"] = game.get("reactions", [])

            if reveal:
                floor_state["safe_color"] = round_data["safe_color"]
                floor_state["announced_color"] = round_data["announced_color"]
                floor_state["is_trap"] = round_data["is_trap"]
                floor_state["safe_tile_ids"] = round_data["safe_tile_ids"]
                floor_state["bonus_tile_id"] = round_data["bonus_tile_id"]
                floor_state["results"] = game["results"]

            result["floor_game"] = floor_state

        elif room["status"] == "completed":
            result["total_rounds"] = FLOOR_ROUNDS
            result["final_results"] = sorted(
                players,
                key=lambda player: player["score"],
                reverse=True,
            )

    elif room["status"] in ("playing", "completed"):
        result["question_number"] = min(
            room["question_index"] + 1,
            len(room["questions"]),
        )
        result["total_questions"] = len(room["questions"])

        if room["status"] == "playing":
            question = room["questions"][room["question_index"]]
            remaining = max(
                0,
                QUESTION_TIME - int(time.time() - room["question_started_at"]),
            )

            result["question"] = {
                "text": question["question"],
                "options": question["options"],
                "time_limit": QUESTION_TIME,
                "remaining_seconds": remaining,
            }

            result["answered_player_ids"] = list(room["answers"].keys())

    if room["status"] == "completed":
        result["final_results"] = sorted(
            players,
            key=lambda player: player["score"],
            reverse=True,
        )

    return result


# ============================================================
# HEALTH
# ============================================================

@app.get("/")
def home():
    return {
        "message": "DON'T TRUST THE FLOOR API is running with Deception & Social Mechanics!"
    }


@app.get("/health")
def health():
    return {
        "status": "ok",
        "rooms": len(rooms),
    }


# ============================================================
# CREATE ROOM
# ============================================================

@app.post("/rooms")
def create_room(request: NicknameRequest):
    nickname = clean_nickname(request.nickname)
    code = generate_room_code()

    host = {
        "id": secrets.token_urlsafe(8),
        "nickname": nickname,
        "is_host": True,
        "ready": False,
        "score": 0,
        "session_token": secrets.token_urlsafe(32),
        "has_used_betrayal": False,
    }

    room = {
        "code": code,
        "host_id": host["id"],
        "status": "lobby",
        "created_at": datetime.now(timezone.utc).isoformat(),
        "players": [host],
        "game_mode": "quiz",
        "questions": [],
        "question_index": 0,
        "question_started_at": 0,
        "answers": {},
        "floor_game": None,
    }

    rooms[code] = room

    return {
        "room": public_room_state(room, host["id"]),
        "player_id": host["id"],
        "session_token": host["session_token"],
    }


# ============================================================
# JOIN ROOM
# ============================================================

@app.post("/rooms/{code}/join")
def join_room(code: str, request: NicknameRequest):
    room = get_room_or_404(code)

    if room["status"] != "lobby":
        raise HTTPException(
            status_code=400,
            detail="Game already started.",
        )

    if len(room["players"]) >= MAX_PLAYERS:
        raise HTTPException(
            status_code=400,
            detail="Room is full.",
        )

    player = {
        "id": secrets.token_urlsafe(8),
        "nickname": clean_nickname(request.nickname),
        "is_host": False,
        "ready": False,
        "score": 0,
        "session_token": secrets.token_urlsafe(32),
        "has_used_betrayal": False,
    }

    room["players"].append(player)

    return {
        "room": public_room_state(room, player["id"]),
        "player_id": player["id"],
        "session_token": player["session_token"],
    }


# ============================================================
# GET ROOM
# ============================================================

@app.get("/rooms/{code}")
def get_room(
    code: str,
    x_session_token: Optional[str] = Header(default=None),
):
    room = get_room_or_404(code)
    player = None
    if x_session_token:
        try:
            player = authenticate_player(room, x_session_token)
        except HTTPException:
            pass
    player_id = player["id"] if player else None
    return public_room_state(room, player_id)


# ============================================================
# READY STATUS
# ============================================================

@app.patch("/rooms/{code}/ready")
def set_ready(
    code: str,
    request: ReadyRequest,
    x_session_token: Optional[str] = Header(default=None),
):
    room = get_room_or_404(code)
    player = authenticate_player(room, x_session_token)

    if room["status"] != "lobby":
        raise HTTPException(
            status_code=400,
            detail="Game already started.",
        )

    player["ready"] = request.ready

    return {
        "message": "Ready status updated.",
        "room": public_room_state(room, player["id"]),
    }


# ============================================================
# DON'T TRUST THE FLOOR: START GAME
# ============================================================

@app.post("/rooms/{code}/floor/start")
def start_floor_game(
    code: str,
    x_session_token: Optional[str] = Header(default=None),
):
    room = get_room_or_404(code)
    player = authenticate_player(room, x_session_token)

    if player["id"] != room["host_id"]:
        raise HTTPException(
            status_code=403,
            detail="Only the host can start.",
        )

    if room["status"] != "lobby":
        raise HTTPException(
            status_code=400,
            detail="Game already started.",
        )

    if len(room["players"]) < 2:
        raise HTTPException(
            status_code=400,
            detail="Need at least 2 players.",
        )

    if not all(p["ready"] for p in room["players"]):
        raise HTTPException(
            status_code=400,
            detail="Everyone must be ready.",
        )

    for player_in_room in room["players"]:
        player_in_room["score"] = 0
        player_in_room["has_used_betrayal"] = False

    room["game_mode"] = "floor"
    room["questions"] = []
    room["question_index"] = 0
    room["question_started_at"] = 0
    room["answers"] = {}

    room["floor_game"] = {
        "rounds": [
            create_floor_round(round_number=index + 1, total_rounds=FLOOR_ROUNDS, players=room["players"])
            for index in range(FLOOR_ROUNDS)
        ],
        "round_index": 0,
        "phase": "choosing",
        "phase_started_at": time.time(),
        "choices": {},
        "results": [],
        "reactions": [],
        "betrayals": {},  # sender_id -> {target_id, message, settled}
        "inbox": {},      # player_id -> [messages]
    }

    room["status"] = "playing"

    return {
        "message": "DON'T TRUST THE FLOOR has started!",
        "room": public_room_state(room, player["id"]),
    }


# ============================================================
# SOCIAL MECHANICS ENDPOINTS (Reactions, Betrayal, Auction)
# ============================================================

class ReactionRequest(BaseModel):
    emoji: str = Field(min_length=1, max_length=10)
    text: str = Field(min_length=1, max_length=50)


@app.post("/rooms/{code}/floor/react")
def send_reaction(
    code: str,
    request: ReactionRequest,
    x_session_token: Optional[str] = Header(default=None),
):
    room = get_room_or_404(code)
    player = authenticate_player(room, x_session_token)
    game = room.get("floor_game")

    if not game or room["status"] != "playing":
        raise HTTPException(status_code=400, detail="Floor game not active.")

    reaction = {
        "player_id": player["id"],
        "nickname": player["nickname"],
        "emoji": request.emoji,
        "text": request.text,
        "timestamp": time.time(),
    }

    if "reactions" not in game:
        game["reactions"] = []

    game["reactions"].append(reaction)
    # Keep only last 10 reactions to prevent bloat
    if len(game["reactions"]) > 10:
        game["reactions"] = game["reactions"][-10:]

    return {"message": "Reaction sent", "room": public_room_state(room, player["id"])}


@app.post("/rooms/{code}/floor/betray")
def use_betrayal(
    code: str,
    request: BetrayalRequest,
    x_session_token: Optional[str] = Header(default=None),
):
    room = get_room_or_404(code)
    player = authenticate_player(room, x_session_token)
    game = room.get("floor_game")

    if not game or room["status"] != "playing":
        raise HTTPException(status_code=400, detail="Floor game not active.")

    if player.get("has_used_betrayal", False):
        raise HTTPException(status_code=400, detail="You have already used your Betrayal Button this match!")

    if player["id"] == request.target_player_id:
        raise HTTPException(status_code=400, detail="You cannot betray yourself.")

    target_exists = any(p["id"] == request.target_player_id for p in room["players"])
    if not target_exists:
        raise HTTPException(status_code=404, detail="Target player not found.")

    player["has_used_betrayal"] = True

    if "betrayals" not in game:
        game["betrayals"] = {}
    if "inbox" not in game:
        game["inbox"] = {}

    game["betrayals"][player["id"]] = {
        "target_id": request.target_player_id,
        "message": request.message,
        "settled": False,
    }

    if request.target_player_id not in game["inbox"]:
        game["inbox"][request.target_player_id] = []

    game["inbox"][request.target_player_id].append({
        "sender_name": "Anonymous Rival",
        "message": request.message,
    })

    return {"message": "Secret message dispatched successfully!", "room": public_room_state(room, player["id"])}


@app.post("/rooms/{code}/floor/auction")
def place_auction_bid(
    code: str,
    request: AuctionBidRequest,
    x_session_token: Optional[str] = Header(default=None),
):
    room = get_room_or_404(code)
    player = authenticate_player(room, x_session_token)
    game = room.get("floor_game")

    if not game or room["status"] != "playing":
        raise HTTPException(status_code=400, detail="Floor game not active.")

    round_data = game["rounds"][game["round_index"]]
    if not round_data["is_final_round"]:
        raise HTTPException(status_code=400, detail="The Truth Auction only occurs in the final round.")

    if round_data["auction_resolved"]:
        raise HTTPException(status_code=400, detail="Auction has already concluded for this round.")

    if player["score"] < request.bid_amount:
        raise HTTPException(status_code=400, detail="You do not have enough points for this bid.")

    round_data["auction_bids"][player["id"]] = request.bid_amount

    return {"message": "Bid recorded!", "room": public_room_state(room, player["id"])}


# ============================================================
# DON'T TRUST THE FLOOR: SELECT A TILE
# ============================================================

@app.post("/rooms/{code}/floor/choose")
def choose_floor_tile(
    code: str,
    request: FloorChoiceRequest,
    x_session_token: Optional[str] = Header(default=None),
):
    room = get_room_or_404(code)
    player = authenticate_player(room, x_session_token)

    if room.get("game_mode") != "floor":
        raise HTTPException(
            status_code=400,
            detail="This room is not playing DON'T TRUST THE FLOOR.",
        )

    if room["status"] != "playing":
        raise HTTPException(
            status_code=400,
            detail="The game is not active.",
        )

    game = room["floor_game"]
    advance_floor_game_if_needed(room)

    if room["status"] != "playing":
        raise HTTPException(
            status_code=400,
            detail="The game has ended.",
        )

    if game["phase"] != "choosing":
        raise HTTPException(
            status_code=400,
            detail="The reveal has already started.",
        )

    if player["id"] in game["choices"]:
        raise HTTPException(
            status_code=409,
            detail="Your tile is already locked in.",
        )

    if time.time() - game["phase_started_at"] >= FLOOR_DECISION_TIME:
        advance_floor_game_if_needed(room)
        raise HTTPException(
            status_code=400,
            detail="Time is up. Wait for the reveal.",
        )

    round_data = game["rounds"][game["round_index"]]
    selected_tile = None

    if request.tile_id:
        selected_tile = next(
            (tile for tile in round_data["tiles"] if tile["id"] == request.tile_id),
            None,
        )
        if selected_tile is None:
            raise HTTPException(
                status_code=422,
                detail="Invalid tile_id for this arena.",
            )
    else:
        tile_color = request.tile_color.strip().lower()
        if tile_color not in FLOOR_COLORS:
            raise HTTPException(
                status_code=422,
                detail="Choose a valid tile color.",
            )
        color_matches = [
            tile for tile in round_data["tiles"]
            if tile["active"] and tile["color"] == tile_color
        ]
        if not color_matches:
            raise HTTPException(
                status_code=422,
                detail="No active tile has that color. Choose another color.",
            )
        selected_tile = secrets.choice(color_matches)

    if not selected_tile["active"]:
        raise HTTPException(
            status_code=422,
            detail="That tile is outside the active arena.",
        )

    game["choices"][player["id"]] = {
        "tile_id": selected_tile["id"],
        "tile_color": selected_tile["color"],
    }

    advance_game_if_needed(room)

    return {
        "message": "Tile locked in!",
        "room": public_room_state(room, player["id"]),
    }

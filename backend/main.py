
import secrets
import string
import time
from datetime import datetime, timezone

from fastapi import FastAPI, HTTPException, Header
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

app = FastAPI(title="Quiz Battle Arena API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "https://quiz-game-ten-khaki.vercel.app/",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

MAX_PLAYERS = 4
QUESTION_TIME = 15
TOTAL_QUESTIONS = 10
rooms = {}

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
        "question": "Which component is responsible for executing instructions in a computer?",
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


class NicknameRequest(BaseModel):
    nickname: str = Field(min_length=1, max_length=20)


class ReadyRequest(BaseModel):
    ready: bool


class AnswerRequest(BaseModel):
    answer_index: int = Field(ge=0, le=3)


def clean_nickname(nickname: str) -> str:
    nickname = " ".join(nickname.split()).strip()
    if not nickname:
        raise HTTPException(status_code=400, detail="Enter a nickname.")
    return nickname[:20]


def generate_room_code() -> str:
    characters = string.ascii_uppercase + string.digits
    while True:
        code = "".join(secrets.choice(characters) for _ in range(6))
        if code not in rooms:
            return code


def advance_game_if_needed(room: dict) -> None:
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


def public_room_state(room: dict) -> dict:
    advance_game_if_needed(room)

    players = []
    for player in room["players"]:
        players.append({
            "id": player["id"],
            "nickname": player["nickname"],
            "is_host": player["is_host"],
            "ready": player["ready"],
            "score": player["score"],
        })

    result = {
        "code": room["code"],
        "host_id": room["host_id"],
        "status": room["status"],
        "created_at": room["created_at"],
        "players": players,
    }

    if room["status"] in ("playing", "completed"):
        result["question_number"] = min(
            room["question_index"] + 1, len(room["questions"])
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
            players, key=lambda player: player["score"], reverse=True
        )

    return result


def get_room_or_404(code: str) -> dict:
    room = rooms.get(code.strip().upper())
    if not room:
        raise HTTPException(status_code=404, detail="Room not found.")
    advance_game_if_needed(room)
    return room


def authenticate_player(room: dict, session_token: str | None) -> dict:
    if not session_token:
        raise HTTPException(status_code=401, detail="Session token missing.")

    for player in room["players"]:
        if secrets.compare_digest(player["session_token"], session_token):
            return player

    raise HTTPException(status_code=401, detail="Invalid session token.")


@app.get("/")
def home():
    return {"message": "Quiz Battle Arena API is running!"}


@app.get("/health")
def health():
    return {"status": "ok", "rooms": len(rooms)}


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
    }

    room = {
        "code": code,
        "host_id": host["id"],
        "status": "lobby",
        "created_at": datetime.now(timezone.utc).isoformat(),
        "players": [host],
        "questions": [],
        "question_index": 0,
        "question_started_at": 0,
        "answers": {},
    }

    rooms[code] = room
    return {
        "room": public_room_state(room),
        "player_id": host["id"],
        "session_token": host["session_token"],
    }


@app.post("/rooms/{code}/join")
def join_room(code: str, request: NicknameRequest):
    room = get_room_or_404(code)

    if room["status"] != "lobby":
        raise HTTPException(status_code=400, detail="Game already started.")
    if len(room["players"]) >= MAX_PLAYERS:
        raise HTTPException(status_code=400, detail="Room is full.")

    player = {
        "id": secrets.token_urlsafe(8),
        "nickname": clean_nickname(request.nickname),
        "is_host": False,
        "ready": False,
        "score": 0,
        "session_token": secrets.token_urlsafe(32),
    }
    room["players"].append(player)

    return {
        "room": public_room_state(room),
        "player_id": player["id"],
        "session_token": player["session_token"],
    }


@app.get("/rooms/{code}")
def get_room(code: str):
    return public_room_state(get_room_or_404(code))


@app.patch("/rooms/{code}/ready")
def set_ready(
    code: str,
    request: ReadyRequest,
    x_session_token: str | None = Header(default=None),
):
    room = get_room_or_404(code)
    player = authenticate_player(room, x_session_token)

    if room["status"] != "lobby":
        raise HTTPException(status_code=400, detail="Game already started.")

    player["ready"] = request.ready
    return {"message": "Ready status updated.", "room": public_room_state(room)}


@app.post("/rooms/{code}/start")
def start_game(
    code: str,
    x_session_token: str | None = Header(default=None),
):
    room = get_room_or_404(code)
    player = authenticate_player(room, x_session_token)

    if player["id"] != room["host_id"]:
        raise HTTPException(status_code=403, detail="Only the host can start.")
    if room["status"] != "lobby":
        raise HTTPException(status_code=400, detail="Game already started.")
    if len(room["players"]) < 2:
        raise HTTPException(status_code=400, detail="Need at least 2 players.")
    if not all(p["ready"] for p in room["players"]):
        raise HTTPException(status_code=400, detail="Everyone must be ready.")

    room["questions"] = secrets.SystemRandom().sample(
        QUESTIONS, k=min(TOTAL_QUESTIONS, len(QUESTIONS))
    )
    room["question_index"] = 0
    room["question_started_at"] = time.time()
    room["answers"] = {}

    for p in room["players"]:
        p["score"] = 0

    room["status"] = "playing"

    return {"message": "Game started!", "room": public_room_state(room)}


@app.post("/rooms/{code}/answer")
def submit_answer(
    code: str,
    request: AnswerRequest,
    x_session_token: str | None = Header(default=None),
):
    room = get_room_or_404(code)
    player = authenticate_player(room, x_session_token)

    if room["status"] != "playing":
        raise HTTPException(status_code=400, detail="No active question.")

    if player["id"] in room["answers"]:
        raise HTTPException(status_code=409, detail="Already answered this question.")

    question = room["questions"][room["question_index"]]
    elapsed = time.time() - room["question_started_at"]

    if elapsed >= QUESTION_TIME:
        advance_game_if_needed(room)
        raise HTTPException(status_code=400, detail="Time is up.")

    correct = request.answer_index == question["correct"]

    points = 0
    if correct:
        points = max(
            500,
            round(1000 * (1 - elapsed / QUESTION_TIME)),
        )
        player["score"] += points

    room["answers"][player["id"]] = {
        "answer_index": request.answer_index,
        "correct": correct,
        "points": points,
    }

    # Advance immediately when everyone has answered.
    advance_game_if_needed(room)

    return {
        "message": "Answer submitted.",
        "correct": correct,
        "points_earned": points,
        "room": public_room_state(room),
    }

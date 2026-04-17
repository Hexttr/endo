from __future__ import annotations
from pydantic import BaseModel
from typing import Optional, Any
from datetime import datetime


class NodeRead(BaseModel):
    id: str
    section: str
    text: str
    description: Optional[str] = None
    input_type: str
    unknown_action: Optional[str] = None
    is_terminal: bool = False
    is_pending: bool = False
    return_node: Optional[str] = None
    allow_multiple: bool = False
    extra: Optional[dict] = None
    options: list[OptionRead] = []

    class Config:
        from_attributes = True


class NodeUpdate(BaseModel):
    text: Optional[str] = None
    description: Optional[str] = None
    input_type: Optional[str] = None
    unknown_action: Optional[str] = None
    extra: Optional[dict] = None


class OptionRead(BaseModel):
    id: int
    option_id: str
    label: str
    next_node_id: Optional[str] = None
    priority: Optional[int] = None
    extra: Optional[dict] = None

    class Config:
        from_attributes = True


class OptionCreate(BaseModel):
    option_id: str
    label: str
    next_node_id: Optional[str] = None
    priority: Optional[int] = None
    extra: Optional[dict] = None


class EdgeRead(BaseModel):
    id: int
    from_node_id: str
    to_node_id: str
    label: Optional[str] = None
    condition_logic: Optional[dict] = None
    priority: int = 0

    class Config:
        from_attributes = True


class FinalRead(BaseModel):
    id: str
    diagnosis: str
    endo_picture: Optional[str] = None
    equipment: Optional[list[str]] = None
    algorithm: Optional[str] = None
    routing: Optional[str] = None
    followup: Optional[str] = None

    class Config:
        from_attributes = True


class FinalUpdate(BaseModel):
    diagnosis: Optional[str] = None
    endo_picture: Optional[str] = None
    equipment: Optional[list[str]] = None
    algorithm: Optional[str] = None
    routing: Optional[str] = None
    followup: Optional[str] = None


class ClassificationRead(BaseModel):
    id: str
    name: str
    data: dict

    class Config:
        from_attributes = True


class SessionRead(BaseModel):
    id: int
    user_id: str
    current_node_id: Optional[str] = None
    collected_data: dict = {}
    unknown_flags: list = []
    status: str
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


class SessionCreate(BaseModel):
    user_id: str


class AnswerSubmit(BaseModel):
    session_id: int
    node_id: str
    answer: Any


class EngineResponse(BaseModel):
    session_id: int
    current_node: Optional[NodeRead] = None
    final: Optional[FinalRead] = None
    finals: Optional[list[FinalRead]] = None
    message: Optional[str] = None
    status: str
    collected_data: dict = {}
    unknown_flags: list = []


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"


class LoginRequest(BaseModel):
    username: str
    password: str

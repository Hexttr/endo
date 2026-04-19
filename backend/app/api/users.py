"""CRUD for User accounts. Admin-only.

Access control:
  * List/read: any authenticated user can list (needed for admin → audit log
    name resolution), but non-admins only see their own row.
  * Create/update/delete: role='admin' only.
  * Users cannot delete themselves — prevents locking oneself out.

Passwords are never returned; `password` is write-only on Create/Update.
"""
from fastapi import APIRouter, Depends, HTTPException, Response
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.database import get_db
from app.models import User, AuditLog
from app.schemas import UserRead, UserCreate, UserUpdate
from app.api.auth import get_current_user, pwd_context


router = APIRouter(prefix="/users", tags=["users"])


def _require_admin(user: User) -> None:
    if user.role != "admin":
        raise HTTPException(status_code=403, detail="Доступно только администраторам")


def _project(u: User) -> dict:
    return {
        "id": u.id,
        "username": u.username,
        "fio": u.fio,
        "role": u.role,
        "created_at": u.created_at,
    }


@router.get("/", response_model=list[UserRead])
async def list_users(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    # Non-admins see only themselves (still useful for "whoami" in UI).
    if current_user.role != "admin":
        return [_project(current_user)]
    rows = (await db.execute(select(User).order_by(User.username))).scalars().all()
    return [_project(u) for u in rows]


@router.get("/me", response_model=UserRead)
async def get_me(current_user: User = Depends(get_current_user)):
    return _project(current_user)


@router.post("/", response_model=UserRead, status_code=201)
async def create_user(
    body: UserCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    _require_admin(current_user)

    username = body.username.strip()
    if not username:
        raise HTTPException(status_code=400, detail="username обязателен")
    if len(body.password) < 6:
        raise HTTPException(status_code=400, detail="Пароль минимум 6 символов")
    role = (body.role or "editor").strip()
    if role not in ("admin", "editor"):
        raise HTTPException(status_code=400, detail="role: admin | editor")

    dup = (await db.execute(select(User).where(User.username == username))).scalar_one_or_none()
    if dup:
        raise HTTPException(status_code=409, detail=f"Пользователь '{username}' уже существует")

    user = User(
        username=username,
        password_hash=pwd_context.hash(body.password),
        fio=body.fio,
        role=role,
    )
    db.add(user)
    db.add(AuditLog(
        user_id=current_user.id, action="create",
        entity_type="user", entity_id=username,
        # Never log the password, even hashed.
        new_value={"username": username, "fio": body.fio, "role": role},
    ))
    await db.commit()
    await db.refresh(user)
    return _project(user)


@router.patch("/{user_id}", response_model=UserRead)
async def update_user(
    user_id: int,
    body: UserUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    _require_admin(current_user)
    user = (await db.execute(select(User).where(User.id == user_id))).scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    updates = body.model_dump(exclude_unset=True)
    # Prevent demoting the last admin — otherwise nobody can manage users.
    if updates.get("role") and updates["role"] != user.role and user.role == "admin":
        remaining_admins = (await db.execute(
            select(User).where(User.role == "admin", User.id != user.id)
        )).scalars().all()
        if not remaining_admins:
            raise HTTPException(
                status_code=409,
                detail="Нельзя снять роль admin с последнего администратора",
            )

    audit_new = {}
    if "password" in updates:
        pw = updates.pop("password")
        if pw:
            if len(pw) < 6:
                raise HTTPException(status_code=400, detail="Пароль минимум 6 символов")
            user.password_hash = pwd_context.hash(pw)
            audit_new["password"] = "***"
    if "fio" in updates:
        user.fio = updates["fio"]
        audit_new["fio"] = updates["fio"]
    if "role" in updates:
        if updates["role"] not in ("admin", "editor"):
            raise HTTPException(status_code=400, detail="role: admin | editor")
        user.role = updates["role"]
        audit_new["role"] = updates["role"]

    db.add(AuditLog(
        user_id=current_user.id, action="update",
        entity_type="user", entity_id=user.username,
        new_value=audit_new,
    ))
    await db.commit()
    await db.refresh(user)
    return _project(user)


@router.delete("/{user_id}", status_code=204)
async def delete_user(
    user_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    _require_admin(current_user)
    if user_id == current_user.id:
        raise HTTPException(status_code=409, detail="Нельзя удалить самого себя")
    user = (await db.execute(select(User).where(User.id == user_id))).scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    if user.role == "admin":
        remaining_admins = (await db.execute(
            select(User).where(User.role == "admin", User.id != user.id)
        )).scalars().all()
        if not remaining_admins:
            raise HTTPException(
                status_code=409,
                detail="Нельзя удалить последнего администратора",
            )

    db.add(AuditLog(
        user_id=current_user.id, action="delete",
        entity_type="user", entity_id=user.username,
        old_value={"fio": user.fio, "role": user.role},
    ))
    await db.delete(user)
    await db.commit()
    return Response(status_code=204)

"""Comandos de administración.

  python -m app.cli crear-admin --email tu@correo.com --nombre "Jorge"
  python -m app.cli importar-monday --token TU_TOKEN [--workspace 123 --workspace 456] [--con-comentarios]
  python -m app.cli dar-acceso --email persona@correo.com --workspace "Clientes SARAHI"
"""
import argparse
import getpass
import os
import sys

from sqlalchemy import select

from app.auth import hash_password
from app.db import Base, SessionLocal, engine
from app.models import User, Workspace, WorkspaceMember


def crear_admin(args):
    password = args.password or getpass.getpass("Contraseña (mínimo 8 caracteres): ")
    if len(password) < 8:
        sys.exit("La contraseña debe tener al menos 8 caracteres")
    with SessionLocal() as db:
        email = args.email.strip().lower()
        user = db.scalar(select(User).where(User.email == email))
        if user:
            user.password_hash = hash_password(password)
            user.role = "admin"
            user.is_active = True
            print(f"Usuario {email} actualizado como administrador")
        else:
            db.add(User(email=email, name=args.nombre, password_hash=hash_password(password), role="admin"))
            print(f"Administrador {email} creado")
        db.commit()


def importar_monday(args):
    from app.importer import MondayClient, import_monday

    token = args.token or os.getenv("MONDAY_API_TOKEN")
    if not token:
        sys.exit("Falta el token de Monday (--token o MONDAY_API_TOKEN)")
    with SessionLocal() as db:
        stats = import_monday(db, MondayClient(token), workspace_ids=args.workspace or None,
                              with_updates=args.con_comentarios, log=print)
    print("Importación terminada:", ", ".join(f"{k}: {v}" for k, v in stats.items()))


def dar_acceso(args):
    with SessionLocal() as db:
        user = db.scalar(select(User).where(User.email == args.email.strip().lower()))
        if user is None:
            sys.exit("No existe un usuario con ese email")
        ws = db.scalar(select(Workspace).where(Workspace.name == args.workspace))
        if ws is None:
            sys.exit("No existe un espacio de trabajo con ese nombre")
        if not db.get(WorkspaceMember, (ws.id, user.id)):
            db.add(WorkspaceMember(workspace_id=ws.id, user_id=user.id))
            db.commit()
        print(f"{user.email} ahora tiene acceso a {ws.name}")


def main():
    Base.metadata.create_all(engine)
    parser = argparse.ArgumentParser(prog="python -m app.cli")
    sub = parser.add_subparsers(required=True)

    p = sub.add_parser("crear-admin", help="Crea (o actualiza) un administrador")
    p.add_argument("--email", required=True)
    p.add_argument("--nombre", default="Administrador")
    p.add_argument("--password", help="Si no lo pasas, se pide de forma oculta")
    p.set_defaults(func=crear_admin)

    p = sub.add_parser("importar-monday", help="Copia espacios, tableros y elementos desde Monday")
    p.add_argument("--token", help="Token de la API de Monday (o variable MONDAY_API_TOKEN)")
    p.add_argument("--workspace", action="append", help="ID de espacio de trabajo de Monday (repetible)")
    p.add_argument("--con-comentarios", action="store_true", help="Importa también las actualizaciones (más lento)")
    p.set_defaults(func=importar_monday)

    p = sub.add_parser("dar-acceso", help="Da acceso a un usuario a un espacio de trabajo")
    p.add_argument("--email", required=True)
    p.add_argument("--workspace", required=True, help="Nombre exacto del espacio de trabajo")
    p.set_defaults(func=dar_acceso)

    args = parser.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()

#!/usr/bin/env bash
# Backup diário: banco + documentos, com envio externo via rclone.
# Instale em /usr/local/bin/imobiliaria-backup.sh e agende no cron.
set -euo pipefail
umask 077

APP_DIR="/opt/imobiliaria"
DATA_DIR="$APP_DIR/data"
BACKUP_DIR="/var/backups/imobiliaria"
RETENTION_DAYS=30

# Configure com: rclone config
# Exemplos: b2:imobiliaria-backup  |  r2:imobiliaria-backup  |  gdrive:imobiliaria-backup
RCLONE_REMOTE="${RCLONE_REMOTE:-}"

STAMP="$(date +%F-%H%M)"
mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"

DB="$BACKUP_DIR/imobiliaria-$STAMP.db"
UPLOADS="$BACKUP_DIR/uploads-$STAMP.tar.gz"

echo "[$(date -Is)] iniciando backup $STAMP"

# Backup consistente mesmo com o sistema rodando (SQLite .backup).
sqlite3 "$DATA_DIR/imobiliaria.db" ".backup '$DB'"
sqlite3 "$DB" "PRAGMA integrity_check;" | grep -qx "ok"

if [ -d "$DATA_DIR/uploads" ]; then
  tar -C "$DATA_DIR" -czf "$UPLOADS" uploads
fi

if [ -n "$RCLONE_REMOTE" ]; then
  if rclone copy "$BACKUP_DIR" "$RCLONE_REMOTE" \
      --include "imobiliaria-$STAMP.db" \
      --include "uploads-$STAMP.tar.gz"; then
    echo "[$(date -Is)] enviado para $RCLONE_REMOTE"
  else
    echo "[$(date -Is)] ERRO: falha no envio para $RCLONE_REMOTE" >&2
    exit 1
  fi
else
  echo "[$(date -Is)] AVISO: RCLONE_REMOTE não definido; backup apenas local" >&2
fi

# Mantém 30 dias localmente.
find "$BACKUP_DIR" -type f -mtime +"$RETENTION_DAYS" -delete

echo "[$(date -Is)] backup concluído"

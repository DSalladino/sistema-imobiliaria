#!/usr/bin/env bash
# Backup diário: banco + documentos (+ chave local de 2FA, se existir),
# com envio externo via rclone.
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
ARQUIVOS="$BACKUP_DIR/dados-$STAMP.tar.gz"

echo "[$(date -Is)] iniciando backup $STAMP"

# Backup consistente mesmo com o sistema rodando (SQLite .backup).
sqlite3 "$DATA_DIR/imobiliaria.db" ".backup '$DB'"
sqlite3 "$DB" "PRAGMA integrity_check;" | grep -qx "ok"

# Ensaio de restauração: abre o backup recém-gerado e compara as contagens.
if [ -f "$APP_DIR/scripts/verificar-restauracao.mjs" ]; then
  (cd "$APP_DIR" && DATA_DIR="$DATA_DIR" node scripts/verificar-restauracao.mjs "$DB")
else
  echo "[$(date -Is)] AVISO: script de ensaio de restauração não encontrado" >&2
fi

# Inclui uploads e, quando não há APP_SECRET, a chave local que decifra o 2FA.
ITENS=()
[ -d "$DATA_DIR/uploads" ] && ITENS+=("uploads")
[ -f "$DATA_DIR/.app-key" ] && ITENS+=(".app-key")
if [ "${#ITENS[@]}" -gt 0 ]; then
  tar -C "$DATA_DIR" -czf "$ARQUIVOS" "${ITENS[@]}"
else
  echo "[$(date -Is)] AVISO: sem uploads nem .app-key para arquivar" >&2
  : > "$ARQUIVOS"
fi

if [ -n "$RCLONE_REMOTE" ]; then
  if rclone copy "$BACKUP_DIR" "$RCLONE_REMOTE" \
      --include "imobiliaria-$STAMP.db" \
      --include "dados-$STAMP.tar.gz"; then
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

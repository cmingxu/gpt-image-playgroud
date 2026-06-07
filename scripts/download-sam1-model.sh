#!/bin/bash
# Download SAM1 ViT-B quantized ONNX model (browser-compatible, inline weights)
# Same model as used in SAM-in-Browser demo
set -e

MODEL_DIR="$(dirname "$0")/../web/public/models/sam1/onnx"
mkdir -p "$MODEL_DIR"

PROXY="${HTTPS_PROXY:-${https_proxy:-${HTTP_PROXY:-${http_proxy:-}}}}"
CURL_OPTS="-L --retry 3 --retry-delay 2"
HF_BASE="${HF_MIRROR:-https://hf-mirror.com}"
REPO="Xenova/sam-vit-base/resolve/main/onnx"

if [ -n "$PROXY" ]; then
  CURL_OPTS="$CURL_OPTS --proxy $PROXY"
  echo "Using proxy: $PROXY"
fi

FILES=(
  "vision_encoder_quantized.onnx"
  "prompt_encoder_mask_decoder_quantized.onnx"
)

for FILE in "${FILES[@]}"; do
  URL="${HF_BASE}/${REPO}/${FILE}"
  echo "Downloading ${FILE}..."
  curl $CURL_OPTS -o "$MODEL_DIR/${FILE}" "$URL"
done

echo ""
echo "Done! Files:"
ls -lh "$MODEL_DIR"

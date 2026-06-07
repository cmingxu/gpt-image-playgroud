#!/bin/bash
# Download SAM2.1 Hiera Base-Plus ONNX model for local use
# Model from onnx-community on HuggingFace
set -e

MODEL_DIR="$(dirname "$0")/../web/public/models/sam2/onnx"
mkdir -p "$MODEL_DIR"

PROXY="${HTTPS_PROXY:-${https_proxy:-${HTTP_PROXY:-${http_proxy:-}}}}"
CURL_OPTS="-L --retry 3 --retry-delay 2"

HF_BASE="${HF_MIRROR:-https://hf-mirror.com}"
REPO="onnx-community/sam2.1-hiera-base-plus-ONNX/resolve/main/onnx"

if [ -n "$PROXY" ]; then
  echo "Using proxy: $PROXY"
  CURL_OPTS="$CURL_OPTS --proxy $PROXY"
fi

FILES=(
  "vision_encoder_int8.onnx"
  "vision_encoder_int8.onnx_data"
  "prompt_encoder_mask_decoder_int8.onnx"
  "prompt_encoder_mask_decoder_int8.onnx_data"
)

for FILE in "${FILES[@]}"; do
  URL="${HF_BASE}/${REPO}/${FILE}"
  echo "Downloading ${FILE}..."
  curl $CURL_OPTS -o "$MODEL_DIR/${FILE}" "$URL"
done

echo ""
echo "Done! Files:"
ls -lh "$MODEL_DIR"

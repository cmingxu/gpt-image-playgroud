#!/bin/bash
# Download SlimSAM-77 ONNX model files for local use
# Models from HuggingFace: Xenova/slimsam-77-uniform
#
# Proxy support: set HTTP_PROXY or HTTPS_PROXY environment variable,
# e.g. HTTPS_PROXY=http://127.0.0.1:7890 ./download-sam-model.sh
set -e

MODEL_DIR="$(dirname "$0")/../web/public/models/sam"
mkdir -p "$MODEL_DIR"

# Resolve proxy from environment variables (both upper and lowercase)
PROXY="${HTTPS_PROXY:-${https_proxy:-${HTTP_PROXY:-${http_proxy:-}}}}"
CURL_OPTS="-L --retry 3 --retry-delay 2"

# Use China mirror for HuggingFace (hf-mirror.com)
HF_BASE="${HF_MIRROR:-https://hf-mirror.com}"
REPO="Xenova/slimsam-77-uniform/resolve/main/onnx"
ENCODER_URL="${HF_BASE}/${REPO}/vision_encoder_quantized.onnx"
DECODER_URL="${HF_BASE}/${REPO}/prompt_encoder_mask_decoder_quantized.onnx"

if [ -n "$PROXY" ]; then
  echo "Using proxy: $PROXY"
  CURL_OPTS="$CURL_OPTS --proxy $PROXY"
fi

echo "Downloading SlimSAM vision encoder (~25 MB)..."
echo "  from: $ENCODER_URL"
curl $CURL_OPTS -o "$MODEL_DIR/slimsam_encoder.onnx" "$ENCODER_URL"

echo "Downloading SlimSAM prompt encoder + mask decoder (~4 MB)..."
echo "  from: $DECODER_URL"
curl $CURL_OPTS -o "$MODEL_DIR/slimsam_decoder.onnx" "$DECODER_URL"

echo "Done! Models saved to $MODEL_DIR"
ls -lh "$MODEL_DIR"

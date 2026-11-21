#!/usr/bin/env bash
# encode.sh <master.mkv> <out.mp4> [crf] [grain]
# H.264 High, yuv420p, BT.709 limited range, 30 fps, a silent stereo track (so chats do not treat the file as a GIF),
# a little temporal luma grain so the dark gradients survive the platforms' re-compression without banding.
set -euo pipefail
IN="$1"; OUT="$2"; CRF="${3:-15}"; GRAIN="${4:-5}"
ffmpeg -y -loglevel error -i "$IN" -f lavfi -i anullsrc=r=48000:cl=stereo \
  -vf "scale=in_range=full:out_range=limited:out_color_matrix=bt709:flags=lanczos,format=yuv420p,noise=c0s=${GRAIN}:c0f=t+u" \
  -c:v libx264 -profile:v high -level 4.2 -preset slow -crf "$CRF" -pix_fmt yuv420p \
  -color_primaries bt709 -color_trc bt709 -colorspace bt709 -color_range tv \
  -r 30 -g 30 -bf 2 -movflags +faststart \
  -c:a aac -b:a 128k -ar 48000 -shortest "$OUT"
ffprobe -v error -show_entries format=duration,size,bit_rate:stream=codec_name,profile,level,width,height,pix_fmt,r_frame_rate,color_range,color_space,color_transfer,color_primaries,channels,sample_rate -of default=nw=1 "$OUT"

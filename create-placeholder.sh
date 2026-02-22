#!/bin/bash
# Create a neutral placeholder image for content without images

# You'll need ImageMagick installed: apt install imagemagick

convert -size 400x300 \
  -background "#0f172a" \
  -fill "#64748b" \
  -gravity center \
  -pointsize 24 \
  -font Arial \
  label:"No Image Available" \
  /root/backend/assets/images/content/placeholder.png

echo "Created placeholder.png"
echo "To replace an offensive image: cp placeholder.png content_id_XXXX.png"

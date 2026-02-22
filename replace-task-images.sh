#!/bin/bash
# Replace multiple task images with a placeholder image

# Directory where images are stored
IMAGE_DIR="/root/backend/assets/images/content"

# Source image (the police/riot image from content_id 12736)
SOURCE_IMAGE=""
for ext in png jpg jpeg webp; do
    if [ -f "$IMAGE_DIR/content_id_12736.$ext" ]; then
        SOURCE_IMAGE="$IMAGE_DIR/content_id_12736.$ext"
        break
    fi
done

# Target content IDs to replace
CONTENT_IDS=(12260 12261 12270 12271 12272 12273 12274 12275 12286 12298 12299 12300 12317 12325 12346 12356 12385 12425 12457 12463 12471 12477 12480 12484)

echo "Replacing task images with police placeholder..."
echo "Source: content_id 12736"
echo ""

# Check if source exists
if [ -z "$SOURCE_IMAGE" ] || [ ! -f "$SOURCE_IMAGE" ]; then
    echo "ERROR: Could not find source image content_id_12736 with any extension (.png, .jpg, .jpeg, .webp)"
    echo "Available images in directory:"
    ls -lh "$IMAGE_DIR"/content_id_127* 2>/dev/null | head -10
    exit 1
fi

echo "Using source: $SOURCE_IMAGE"
echo ""

if [ ! -f "$SOURCE_IMAGE" ]; then
    echo "ERROR: Could not find any source image!"
    echo "Please specify the correct source image file."
    exit 1
fi

# Get the extension of the source image
SOURCE_EXT="${SOURCE_IMAGE##*.}"

# Counter
COUNT=0

# Copy to each content_id
for content_id in "${CONTENT_IDS[@]}"; do
    TARGET="$IMAGE_DIR/content_id_${content_id}.${SOURCE_EXT}"

    # Remove existing images with any extension first
    rm -f "$IMAGE_DIR/content_id_${content_id}".{png,jpg,jpeg,webp} 2>/dev/null

    # Copy the source image
    cp "$SOURCE_IMAGE" "$TARGET"

    if [ $? -eq 0 ]; then
        echo "✓ Copied to content_id_${content_id}.${SOURCE_EXT}"
        ((COUNT++))
    else
        echo "✗ Failed to copy content_id_${content_id}"
    fi
done

echo ""
echo "Done! Replaced $COUNT images."
echo ""
echo "NOTE: You can manually set the source image by editing this script"
echo "and changing the SOURCE_IMAGE variable at the top."

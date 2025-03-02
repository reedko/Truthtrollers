#!/bin/bash

while IFS= read -r file; do
    # Ensure file path is correct (prepend `backend/` if necessary)
    if [[ "$file" != backend/* ]]; then
        file="backend/$file"
    fi

    # Find the last commit where the file existed
    commit=$(git log --diff-filter=A --max-count=1 --format="%H" -- "$file")

    # If a commit is found, restore the file
    if [ -n "$commit" ]; then
        echo "Restoring $file from commit $commit..."
        git checkout "$commit" -- "$file"
    else
        echo "File $file not found in Git history!"
    fi
done < missing-files.txt

echo "All missing files restored! Now commit them:"
echo "git add . && git commit -m 'Restored missing images' && git push"

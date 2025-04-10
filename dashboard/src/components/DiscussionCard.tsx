// src/components/DiscussionCard.tsx
import React from "react";
import { DiscussionEntry } from "../../../shared/entities/types";
import clsx from "clsx";
import { Box } from "@chakra-ui/react";

interface Props {
  entry: DiscussionEntry;
}

const getFadeLevel = (score?: number) => {
  if (score === undefined) return "opacity-40";
  if (score > 0.75) return "bg-green-100 border-green-500";
  if (score > 0.25) return "bg-green-50 border-green-300";
  if (score < -0.75) return "bg-red-100 border-red-500";
  if (score < -0.25) return "bg-red-50 border-red-300";
  return "bg-gray-50 border-gray-200";
};

const DiscussionCard: React.FC<Props> = ({ entry }) => {
  const fadeStyle = getFadeLevel(entry.citation_score);

  return (
    <div
      className={clsx(
        "p-3 rounded border mb-2 shadow-sm transition-all",
        fadeStyle
      )}
    >
      <div className="text-sm text-gray-800 whitespace-pre-line">
        <Box
          bg="gray.50"
          p={4}
          borderRadius="md"
          border="1px solid"
          borderColor="gray.200"
          fontSize="md"
          fontWeight="medium"
          whiteSpace="pre-wrap"
          color="gray.800"
        >
          {entry.text}
        </Box>
      </div>
      {entry.citation_url && (
        <div className="text-xs text-blue-700 mt-1">
          📎{" "}
          <a href={entry.citation_url} target="_blank" rel="noreferrer">
            {entry.citation_url}
          </a>
        </div>
      )}
      <div className="text-xs text-gray-500 mt-1">
        {new Date(entry.created_at).toLocaleString()}
      </div>
    </div>
  );
};

export default DiscussionCard;

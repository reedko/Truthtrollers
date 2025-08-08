// components/RefreshVerimeterButton.tsx
import { useState } from "react";
type RefreshVerimeterButtonProps = {
  targetClaimId: number;
  onUpdated?: (newScore: number | null) => void;
  handleRefresh: (contentId: number) => Promise<void>;
};

const RefreshVerimeterButton: React.FC<RefreshVerimeterButtonProps> = ({
  targetClaimId,
  onUpdated,
  handleRefresh,
}) => {
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  const handleClick = async () => {
    setLoading(true);
    setStatus(null);
    try {
      await handleRefresh(targetClaimId);
      setStatus("Updated!");
      if (onUpdated) {
        // Optionally pass the new score up (handled by parent)
      }
    } catch (e) {
      setStatus("Failed to update!");
    }
    setLoading(false);
  };

  return (
    <button onClick={handleClick} disabled={loading}>
      {loading ? "Updating..." : "Refresh Verimeter"}
      {status && <span style={{ marginLeft: 8 }}>{status}</span>}
    </button>
  );
};

export default RefreshVerimeterButton;

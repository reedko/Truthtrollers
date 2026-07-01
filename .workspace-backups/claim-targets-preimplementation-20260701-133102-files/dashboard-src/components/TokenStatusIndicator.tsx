import React, { useState, useEffect } from 'react';
import { Box, Badge, Tooltip, Text, VStack, HStack, Icon } from '@chakra-ui/react';
import { CheckCircleIcon, WarningIcon, TimeIcon } from '@chakra-ui/icons';
import { useAuthStore } from '../store/useAuthStore';
import { getTokenInfo } from '../utils/tokenUtils';

export const TokenStatusIndicator: React.FC = () => {
  const token = useAuthStore((s) => s.token);
  const user = useAuthStore((s) => s.user);
  const [tokenInfo, setTokenInfo] = useState(() => getTokenInfo(token));

  // Update token info every 30 seconds
  useEffect(() => {
    const updateInfo = () => {
      setTokenInfo((prevInfo) => {
        const info = getTokenInfo(token);

        // Log status changes
        if (prevInfo.expired !== info.expired ||
            (prevInfo.minutesRemaining !== info.minutesRemaining && info.minutesRemaining !== null && info.minutesRemaining <= 10)) {

          if (info.expired && !prevInfo.expired) {
            console.error('🔴 [Token Status Indicator] Token just EXPIRED!');
            console.error(`   Expired at: ${info.expiresAt ? new Date(info.expiresAt).toLocaleTimeString() : 'unknown'}`);
          } else if (info.minutesRemaining !== null && info.minutesRemaining <= 10) {
            const icon = info.minutesRemaining < 5 ? '🔴' : '🟡';
            console.warn(`${icon} [Token Status Indicator] Token status: ${info.minutesRemaining} min remaining`);
          }
        }

        return info;
      });
    };

    updateInfo(); // Initial update

    const interval = setInterval(updateInfo, 30000); // Update every 30 seconds

    return () => clearInterval(interval);
  }, [token]);

  if (!user || !token) {
    return null; // Not logged in
  }

  const { valid, expired, minutesRemaining } = tokenInfo;

  // Determine status color and icon
  let colorScheme: string;
  let statusIcon: any;
  let statusText: string;

  if (expired) {
    colorScheme = 'red';
    statusIcon = WarningIcon;
    statusText = 'Expired';
  } else if ((minutesRemaining ?? 0) < 5) {
    colorScheme = 'yellow';
    statusIcon = WarningIcon;
    statusText = 'Expiring Soon';
  } else if ((minutesRemaining ?? 0) < 10) {
    colorScheme = 'orange';
    statusIcon = TimeIcon;
    statusText = 'Active';
  } else {
    colorScheme = 'green';
    statusIcon = CheckCircleIcon;
    statusText = 'Active';
  }

  const tooltipLabel = (
    <VStack align="start" spacing={1} p={1}>
      <Text fontSize="xs" fontWeight="bold">
        Session Status: {statusText}
      </Text>
      <Text fontSize="xs">
        {expired
          ? 'Your session has expired'
          : minutesRemaining !== null
          ? `Expires in ${minutesRemaining} minute${minutesRemaining !== 1 ? 's' : ''}`
          : 'Unknown expiration'}
      </Text>
      {expired && (
        <Text fontSize="xs" color="red.200">
          Please refresh the page to log in again
        </Text>
      )}
    </VStack>
  );

  return (
    <Tooltip label={tooltipLabel} placement="bottom" hasArrow>
      <Badge
        colorScheme={colorScheme}
        variant="subtle"
        fontSize="0.7em"
        px={2}
        py={1}
        borderRadius="md"
        cursor="pointer"
        display="flex"
        alignItems="center"
        gap={1}
      >
        <Icon as={statusIcon} boxSize={3} />
        <Text>
          {expired
            ? 'Session Expired'
            : minutesRemaining !== null && minutesRemaining < 10
            ? `${minutesRemaining}m`
            : 'Active'}
        </Text>
      </Badge>
    </Tooltip>
  );
};

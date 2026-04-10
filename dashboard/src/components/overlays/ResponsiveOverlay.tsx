// src/components/overlays/ResponsiveOverlay.tsx
import React from "react";
import {
  useBreakpointValue,
  useColorMode,
  Modal,
  ModalOverlay,
  ModalContent,
  ModalHeader,
  ModalBody,
  ModalFooter,
  ModalCloseButton,
  Drawer,
  DrawerOverlay,
  DrawerContent,
  DrawerHeader,
  DrawerBody,
  DrawerFooter,
  DrawerCloseButton,
  Box,
} from "@chakra-ui/react";

type Props = {
  isOpen: boolean;
  onClose: () => void;
  title?: React.ReactNode;
  footer?: React.ReactNode;
  children: React.ReactNode;
  size?: string; // "sm" | "md" | "lg" | "xl" | "full"
};

export default function ResponsiveOverlay({
  isOpen,
  onClose,
  title,
  footer,
  children,
  size = "lg",
}: Props) {
  const isMobile = useBreakpointValue({ base: true, md: false });
  const { colorMode } = useColorMode();

  if (isMobile) {
    return (
      <Drawer isOpen={isOpen} onClose={onClose} placement="bottom" size="full">
        <DrawerOverlay backdropFilter="blur(8px)" bg="rgba(0, 0, 0, 0.6)" />
        <DrawerContent
          bg="rgba(10, 15, 25, 0.85)"
          backdropFilter="blur(30px)"
          color="white"
          border="2px solid"
          borderColor="rgba(113, 219, 255, 0.4)"
          borderLeftRadius="24px"
          boxShadow="0 24px 64px rgba(0, 0, 0, 0.8), 0 12px 32px rgba(0, 0, 0, 0.6), 0 0 60px rgba(113, 219, 255, 0.3), inset 0 2px 0 rgba(255, 255, 255, 0.15)"
          position="relative"
          overflow="hidden"
        >
          {/* Curved left edge glow */}
          <Box
            position="absolute"
            left={0}
            top={0}
            width="32px"
            height="100%"
            background="linear-gradient(90deg, rgba(113, 219, 255, 0.4) 0%, transparent 100%)"
            borderLeftRadius="24px"
            pointerEvents="none"
            zIndex={0}
          />
          {/* Radial background glow */}
          <Box
            position="absolute"
            top="-20%"
            right="-10%"
            width="60%"
            height="60%"
            bgGradient="radial-gradient(circle, rgba(113, 219, 255, 0.15) 0%, transparent 70%)"
            pointerEvents="none"
            zIndex={0}
          />
          <DrawerCloseButton color="white" zIndex={2} />
          {title && <DrawerHeader position="relative" zIndex={1} fontWeight="bold">{title}</DrawerHeader>}
          <DrawerBody position="relative" zIndex={1}>{children}</DrawerBody>
          {footer && <DrawerFooter position="relative" zIndex={1} borderTopWidth="2px" borderColor="rgba(113, 219, 255, 0.3)" bg="rgba(10, 15, 25, 0.8)" backdropFilter="blur(20px)">{footer}</DrawerFooter>}
        </DrawerContent>
      </Drawer>
    );
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      size={size}
      isCentered
      scrollBehavior="inside"
      closeOnOverlayClick={true}
    >
      <ModalOverlay backdropFilter="blur(8px)" bg="rgba(0, 0, 0, 0.6)" />
      <ModalContent
        bg="rgba(10, 15, 25, 0.85)"
        backdropFilter="blur(30px)"
        color="white"
        border="2px solid"
        borderColor="rgba(113, 219, 255, 0.4)"
        borderLeftRadius="24px"
        boxShadow="0 24px 64px rgba(0, 0, 0, 0.8), 0 12px 32px rgba(0, 0, 0, 0.6), 0 0 60px rgba(113, 219, 255, 0.3), inset 0 2px 0 rgba(255, 255, 255, 0.15)"
        position="relative"
        overflow="hidden"
      >
        {/* Curved left edge glow */}
        <Box
          position="absolute"
          left={0}
          top={0}
          width="32px"
          height="100%"
          background="linear-gradient(90deg, rgba(113, 219, 255, 0.4) 0%, transparent 100%)"
          borderLeftRadius="24px"
          pointerEvents="none"
          zIndex={0}
        />
        {/* Radial background glow */}
        <Box
          position="absolute"
          top="-20%"
          right="-10%"
          width="60%"
          height="60%"
          bgGradient="radial-gradient(circle, rgba(113, 219, 255, 0.15) 0%, transparent 70%)"
          pointerEvents="none"
          zIndex={0}
        />
        <ModalCloseButton color="white" zIndex={2} />
        {title && <ModalHeader position="relative" zIndex={1} fontWeight="bold">{title}</ModalHeader>}
        <ModalBody position="relative" zIndex={1}>{children}</ModalBody>
        {footer && <ModalFooter position="relative" zIndex={1} borderTopWidth="2px" borderColor="rgba(113, 219, 255, 0.3)" bg="rgba(10, 15, 25, 0.8)" backdropFilter="blur(20px)">{footer}</ModalFooter>}
      </ModalContent>
    </Modal>
  );
}

// src/components/overlays/ResponsiveOverlay.tsx
import React from "react";
import {
  useBreakpointValue,
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

  if (isMobile) {
    return (
      <Drawer isOpen={isOpen} onClose={onClose} placement="bottom" size="full">
        <DrawerOverlay />
        <DrawerContent className="mr-modal">
          <DrawerCloseButton />
          {title && <DrawerHeader className="mr-modal-header">{title}</DrawerHeader>}
          <DrawerBody>{children}</DrawerBody>
          {footer && <DrawerFooter>{footer}</DrawerFooter>}
        </DrawerContent>
      </Drawer>
    );
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      size={size}
      scrollBehavior="inside"
    >
      <ModalOverlay />
      <ModalContent className="mr-modal">
        <ModalCloseButton />
        {title && <ModalHeader className="mr-modal-header">{title}</ModalHeader>}
        <ModalBody>{children}</ModalBody>
        {footer && <ModalFooter>{footer}</ModalFooter>}
      </ModalContent>
    </Modal>
  );
}

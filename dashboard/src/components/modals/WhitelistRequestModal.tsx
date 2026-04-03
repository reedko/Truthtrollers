import React, { useState } from "react";
import {
  Modal,
  ModalOverlay,
  ModalContent,
  ModalHeader,
  ModalBody,
  ModalFooter,
  ModalCloseButton,
  Button,
  FormControl,
  FormLabel,
  Input,
  Textarea,
  VStack,
  Text,
  useToast,
  Box,
  Icon,
} from "@chakra-ui/react";
import { FiCheckCircle, FiMail } from "react-icons/fi";

const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL || "http://localhost:5001";

interface WhitelistRequestModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const WhitelistRequestModal: React.FC<WhitelistRequestModalProps> = ({
  isOpen,
  onClose,
}) => {
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [reason, setReason] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
  const toast = useToast();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!email.trim()) {
      toast({
        title: "Email required",
        description: "Please enter your email address",
        status: "warning",
        duration: 3000,
        isClosable: true,
      });
      return;
    }

    setIsSubmitting(true);

    try {
      const response = await fetch(`${API_BASE_URL}/api/whitelist-request`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          email: email.trim(),
          name: name.trim() || null,
          reason: reason.trim() || null,
        }),
      });

      const data = await response.json();

      if (response.ok) {
        setIsSuccess(true);
        toast({
          title: "Request submitted!",
          description: data.message,
          status: "success",
          duration: 5000,
          isClosable: true,
        });

        // Reset form after a delay and close
        setTimeout(() => {
          setEmail("");
          setName("");
          setReason("");
          setIsSuccess(false);
          onClose();
        }, 3000);
      } else {
        toast({
          title: "Submission failed",
          description: data.error || "Please try again",
          status: "error",
          duration: 5000,
          isClosable: true,
        });
      }
    } catch (error) {
      console.error("Whitelist request error:", error);
      toast({
        title: "Network error",
        description: "Unable to submit request. Please try again.",
        status: "error",
        duration: 5000,
        isClosable: true,
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleClose = () => {
    if (!isSubmitting) {
      setEmail("");
      setName("");
      setReason("");
      setIsSuccess(false);
      onClose();
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={handleClose} size="md" isCentered>
      <ModalOverlay bg="blackAlpha.700" backdropFilter="blur(10px)" />
      <ModalContent
        bg="linear-gradient(135deg, rgba(15, 23, 42, 0.95), rgba(30, 41, 59, 0.9))"
        border="1px solid rgba(0, 162, 255, 0.3)"
        borderRadius="16px"
        boxShadow="0 10px 40px rgba(0, 0, 0, 0.7), 0 0 50px rgba(0, 162, 255, 0.3)"
      >
        <ModalHeader
          color="#71dbff"
          fontFamily="Futura, 'Century Gothic', 'Avenir Next', sans-serif"
          fontSize="xl"
          borderBottom="1px solid rgba(0, 162, 255, 0.2)"
          pb={4}
        >
          <Icon as={FiMail} mr={2} />
          Request Early Access
        </ModalHeader>
        <ModalCloseButton color="#71dbff" />

        <form onSubmit={handleSubmit}>
          <ModalBody py={6}>
            {isSuccess ? (
              <VStack spacing={4} py={6}>
                <Icon as={FiCheckCircle} boxSize={16} color="#61efb8" />
                <Text
                  color="#d4e9ff"
                  fontSize="lg"
                  textAlign="center"
                  fontWeight="600"
                >
                  Request Submitted!
                </Text>
                <Text color="#89a9bf" fontSize="sm" textAlign="center">
                  We'll review your request and notify you via email when
                  you're approved.
                </Text>
              </VStack>
            ) : (
              <VStack spacing={4}>
                <Text color="#b4c9e0" fontSize="sm" mb={2}>
                  TruthTrollers is currently in private beta. Enter your email
                  to request access and we'll get back to you soon!
                </Text>

                <FormControl isRequired>
                  <FormLabel color="#89a9bf" fontSize="sm">
                    Email Address
                  </FormLabel>
                  <Input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="your@email.com"
                    bg="rgba(0, 0, 0, 0.3)"
                    border="1px solid rgba(0, 162, 255, 0.3)"
                    color="#d4e9ff"
                    _placeholder={{ color: "#89a9bf" }}
                    _hover={{ borderColor: "rgba(0, 162, 255, 0.5)" }}
                    _focus={{
                      borderColor: "#71dbff",
                      boxShadow: "0 0 0 1px #71dbff",
                    }}
                    disabled={isSubmitting}
                  />
                </FormControl>

                <FormControl>
                  <FormLabel color="#89a9bf" fontSize="sm">
                    Name (Optional)
                  </FormLabel>
                  <Input
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Your name"
                    bg="rgba(0, 0, 0, 0.3)"
                    border="1px solid rgba(0, 162, 255, 0.3)"
                    color="#d4e9ff"
                    _placeholder={{ color: "#89a9bf" }}
                    _hover={{ borderColor: "rgba(0, 162, 255, 0.5)" }}
                    _focus={{
                      borderColor: "#71dbff",
                      boxShadow: "0 0 0 1px #71dbff",
                    }}
                    disabled={isSubmitting}
                  />
                </FormControl>

                <FormControl>
                  <FormLabel color="#89a9bf" fontSize="sm">
                    Why do you want to join? (Optional)
                  </FormLabel>
                  <Textarea
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    placeholder="Tell us about your interest in TruthTrollers..."
                    rows={4}
                    bg="rgba(0, 0, 0, 0.3)"
                    border="1px solid rgba(0, 162, 255, 0.3)"
                    color="#d4e9ff"
                    _placeholder={{ color: "#89a9bf" }}
                    _hover={{ borderColor: "rgba(0, 162, 255, 0.5)" }}
                    _focus={{
                      borderColor: "#71dbff",
                      boxShadow: "0 0 0 1px #71dbff",
                    }}
                    disabled={isSubmitting}
                  />
                </FormControl>
              </VStack>
            )}
          </ModalBody>

          {!isSuccess && (
            <ModalFooter borderTop="1px solid rgba(0, 162, 255, 0.2)" pt={4}>
              <Button
                variant="ghost"
                mr={3}
                onClick={handleClose}
                color="#89a9bf"
                _hover={{ bg: "rgba(255, 255, 255, 0.05)" }}
                disabled={isSubmitting}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                bg="linear-gradient(135deg, rgba(0, 162, 255, 0.2), rgba(0, 162, 255, 0.3))"
                color="#71dbff"
                border="1px solid rgba(0, 162, 255, 0.4)"
                _hover={{
                  bg: "linear-gradient(135deg, rgba(0, 162, 255, 0.3), rgba(0, 162, 255, 0.4))",
                  boxShadow: "0 0 20px rgba(0, 162, 255, 0.4)",
                }}
                isLoading={isSubmitting}
                loadingText="Submitting..."
              >
                Submit Request
              </Button>
            </ModalFooter>
          )}
        </form>
      </ModalContent>
    </Modal>
  );
};

export default WhitelistRequestModal;

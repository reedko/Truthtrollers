import { Flex, HStack, Image, Input, Spacer } from "@chakra-ui/react";
import ColorModeSwitch from "./ColorModeSwitch";
import { Link } from "react-router-dom";
import { useTaskStore } from "../store/useTaskStore";

const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL || "http://localhost:5001";

const NavBar = () => {
  const setSearchQuery = useTaskStore((state) => state.setSearchQuery);

  const handleSearchChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    setSearchQuery(event.target.value);
  };

  return (
    <Flex as="nav" align="center" padding="10px" width="100%" boxShadow="sm">
      <Link to="/">
        <Image src={`${API_BASE_URL}/assets/ttlogo11.png`} boxSize="80px" />
      </Link>
      <Input
        placeholder="Search tasks..."
        onChange={handleSearchChange}
        marginLeft="20px"
        maxWidth="400px"
        flex="1"
      />
      <Spacer />
      <ColorModeSwitch />
    </Flex>
  );
};

export default NavBar;

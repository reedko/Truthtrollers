import { HStack, Image, Input } from "@chakra-ui/react";
import ColorModeSwitch from "./ColorModeSwitch";
import SearchInput from "./SearchInput";
import { Link } from "react-router-dom";
import { useSearchStore } from "../store/useSearchStore";

const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL || "http://localhost:5001";

const NavBar = () => {
  const { setSearchQuery } = useSearchStore();

  const handleSearchChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    setSearchQuery(event.target.value);
  };
  return (
    <HStack padding="10px">
      <Link to="/">
        <Image src={`${API_BASE_URL}/assets/ttlogo11.png`} boxSize="80px" />
      </Link>
      <Input
        placeholder="Search tasks..."
        onChange={handleSearchChange}
        width="300px"
      />
      <ColorModeSwitch />
    </HStack>
  );
};

export default NavBar;

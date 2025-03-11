import { useEffect } from "react";
import { Box } from "@chakra-ui/react";
import NavBar from "../components/NavBar";
import { Outlet, useLocation } from "react-router-dom";
import { useLastVisitedURL } from "../hooks/useLastVisitedUrl";

const Layout = () => {
  useLastVisitedURL(); // ✅ Now tracks the last visited page
  return (
    <>
      <NavBar />
      <Box padding={5}>
        <Outlet />
      </Box>
    </>
  );
};

export default Layout;

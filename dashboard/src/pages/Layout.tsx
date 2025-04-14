import { useEffect } from "react";
import { Box } from "@chakra-ui/react";
import NavBar from "../components/NavBar";
import { Outlet, useLocation } from "react-router-dom";
import { useLastVisitedURL } from "../hooks/useLastVisitedUrl";
import { useAuthStore } from "../store/useAuthStore";

const Layout = () => {
  useLastVisitedURL(); // ✅ Now tracks the last visited page
  const setUser = useAuthStore((s) => s.setUser);

  useEffect(() => {
    const storedUser = localStorage.getItem("user");
    if (storedUser) {
      try {
        const parsedUser = JSON.parse(storedUser);
        setUser(parsedUser);
      } catch (err) {
        console.warn("⚠️ Failed to parse stored user:", err);
      }
    }
  }, [setUser]);

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

import React from "react";
import bullsEye from "../assets/bulls-eye.webp";
import thumbsUp from "../assets/thumbs-up.webp";
import meh from "../assets/meh.webp";
import { Image, ImageProps } from "@chakra-ui/react";

interface Props {
  rating: string;
}
const Emoji = ({ rating }: Props) => {
  const alphaVal = rating.toLowerCase().charCodeAt(0) - 97 + 1;
  if (alphaVal > 3) return null;

  const emojiMap: { [alphaVal: number]: ImageProps } = {
    3: { src: meh, alt: "meh", boxSize: "25px" },
    2: { src: thumbsUp, alt: "recommended", boxSize: "25px" },
    1: { src: bullsEye, alt: "exceptional", boxSize: "35px" },
  };
  return <Image {...emojiMap[alphaVal]} marginTop={1}></Image>;
};

export default Emoji;

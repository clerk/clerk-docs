import { Center } from "@chakra-ui/react";
import Image from "next/image";

export const Images = ({src, alt,width,height} : {src: string, alt: string, width: number, height: number}) => {
    return (
        <Center>
        <Image
            src={src}
            width={width}
            height={height}
            alt={alt}
        />
        </Center>
    );
    };

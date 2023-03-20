
import Image from "next/image";

export const Images = ({src, alt,width,height} : {src: string, alt: string, width: number, height: number}) => {
    return (
        <div className="container flex mx-auto justify-center">
        <Image
            src={src}
            width={width}
            height={height}
            alt={alt}
        />
        </div>
    );
};

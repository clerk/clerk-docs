import { FC } from "react";

export const YouTube: FC<{ id: string }> = ({ id }) => {
    return (
      <div>
        <iframe
          width="100%"
          height="450"
          src={"https://www.youtube.com/embed/" + id}
          title="YouTube video player"
          frameBorder="0"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
        ></iframe>
      </div>
    );
  };
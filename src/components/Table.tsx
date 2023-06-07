type TableRow = {
  cells: Array<string | React.ReactNode>;
};

interface HeadingMeta {
  maxWidth?: string;
}

export const Tables = ({
  headings,
  headingsMeta,
  rows,
}: {
  headings: Array<string>;
  headingsMeta: Array<HeadingMeta>;
  rows: TableRow[];
}) => {
  return (
    <div className="flex flex-col overflow-x-auto">
      <div className="sm:-mx-6 lg:-mx-8">
        <div className="inline-block min-w-full py-2 sm:px-6 lg:px-8">
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm text-left">
              <thead className="font-medium border-b border-[#C4B5FF]">
                <tr>
                  {headings?.map((heading, index) => {
                    const maxWidth =
                      headingsMeta?.[index]?.maxWidth ?? undefined;
                    return (
                      <th
                        style={{
                          maxWidth,
                        }}
                        scope="col"
                        className={`px-6 py-4 ${
                          maxWidth ? "whitespace-pre-wrap" : ""
                        }`}
                        key={`th-${index}`}
                      >
                        {heading}
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {rows.map((row, index) => (
                  <tr
                    className="border-b border-[#C4B5FF]"
                    key={`row-${index}`}
                  >
                    {row.cells.map((cell, idx) => {
                      const result =
                        typeof cell === "string" ? cell.split(/\r?\n/) : [];
                      const maxWidth =
                        headingsMeta?.[idx]?.maxWidth ?? undefined;

                      if (result.length > 1) {
                        return (
                          <td
                            className={`whitespace-nowrap px-6 py-4 ${
                              maxWidth ? "whitespace-pre-wrap" : ""
                            }`}
                            key={`cell-${index}-${idx}`}
                            style={{
                              maxWidth,
                            }}
                          >
                            {result.map((line, i) => (
                              <span className="my-2 " key={`line-${i}`}>
                                {line}
                                <br />
                              </span>
                            ))}
                          </td>
                        );
                      }

                      return (
                        <td
                          className={`whitespace-nowrap px-6 py-4 ${
                            maxWidth ? "whitespace-pre-wrap" : ""
                          }`}
                          key={`cell-${index}-${idx}`}
                          style={{
                            maxWidth,
                          }}
                        >
                          {cell}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
};

type TableRow = {
  cells: Array<string>;
};

export const Tables = ({
  headings,
  rows,
}: {
  headings: Array<string>;
  rows: TableRow[];
}) => {
  return (
    <div className="flex flex-col overflow-x-auto">
  <div className="sm:-mx-6 lg:-mx-8">
    <div className="inline-block min-w-full py-2 sm:px-6 lg:px-8">
      <div className="overflow-x-auto">
      <table className="min-w-full text-left text-sm">
        <thead className="border-b font-medium dark:border-neutral-500">
          <tr>
            {headings?.map((heading, index) => (
              <th scope="col" className="px-6 py-4" key={`th-${index}`}>
                {heading}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr className="border-b dark:border-neutral-500" key={`row-${index}`}>
              {row.cells.map((cell, idx) => {
                const result = cell.split(/\r?\n/);
                if (result.length > 1) {
                  return (
                    <td
                      className="whitespace-nowrap px-6 py-4"
                      key={`cell-${index}-${idx}`}
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
                    className="whitespace-nowrap px-6 py-4"
                    key={`cell-${index}-${idx}`}
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

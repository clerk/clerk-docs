import {
  Table,
  Thead,
  Tbody,
  Tr,
  Th,
  Td,
  TableContainer,
} from "@chakra-ui/react";

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
    <TableContainer>
      <Table variant="simple">
        <Thead>
          <Tr>
            {headings?.map((heading, index) => (
              <Th key={`th-${index}`}>{heading}</Th>
            ))}
          </Tr>
        </Thead>
        <Tbody>
          {rows.map((row, index) => (
            <Tr key={`row-${index}`}>
              {row.cells.map((cell, idx) => {
                const result = cell.split(/\r?\n/);
                if (result.length > 1) {
                    return (
                        <Td key={`cell-${index}-${idx}`}>
                            {result.map((line, i) => (
                                <span key={`line-${i}`}>{line}<br /></span>
                            ))}
                        </Td>
                    );
                }
                
                return <Td key={`cell-${index}-${idx}`}>{cell}</Td>;
              })}
            </Tr>
          ))}
        </Tbody>
      </Table>
    </TableContainer>
  );
};

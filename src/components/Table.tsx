import {
    Table,
    Thead,
    Tbody,
    Tr,
    Th,
    Td,
    TableContainer,
  } from '@chakra-ui/react'


  type TableRow = {
    cells: Array<string>
  };

export const Tables = ({headings, rows}: {headings:Array<string>, rows: TableRow[]  }) => {
    return (
    <TableContainer>
  <Table variant='simple'>
    <Thead>
      <Tr>
      {headings?.map((heading, index) => (
                  <Th
                    key={`th-${index}`}
                  >
                    {heading}
                  </Th>
                ))}
      </Tr>
    </Thead>
    <Tbody>
    {rows.map((row, index) => (
                <Tr key={`row-${index}`}>
                  {row.cells.map((cell, idx) => (
                    <Td
                      key={`cell-${index}-${idx}`}
                    >
                      
                      {cell}
                      
                    </Td>
                  ))}
                </Tr>
                
              ))}
    </Tbody>
  </Table>
</TableContainer>
)
}
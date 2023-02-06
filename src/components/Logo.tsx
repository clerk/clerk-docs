import Image from "next/image"
import { Flex, Text, useColorModeValue } from '@chakra-ui/react';


export const Logo = (): JSX.Element  => {
  const logo = useColorModeValue(
    '/images/clerk-logomark-light.svg',
    '/images/clerk-logomark-dark.svg'
  );

  return (
      <Flex as="a" align="center" display="inline-flex" my={4} gap={3}>
        <Image src={logo} alt="Clerk logo" height="24" width="24" />
        <Text textStyle="xl-medium" color="var(--primaryTextColor)">
          Clerk Docs
        </Text>
      </Flex>
  );
}
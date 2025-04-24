// a fake component that takes the possible props and creates a mdx node
// SDKLink is used for the links that get replaced as they point to a sdk scoped page

import type { SDK } from '../schemas'
import { u as mdastBuilder } from 'unist-builder'

export const SDKLink = (
  props: { href: string; sdks: SDK[]; code: true } | { href: string; sdks: SDK[]; code: false; children: unknown },
) => {
  if (props.code) {
    return mdastBuilder('mdxJsxTextElement', {
      name: 'SDKLink',
      attributes: [
        mdastBuilder('mdxJsxAttribute', {
          name: 'href',
          value: props.href,
        }),
        mdastBuilder('mdxJsxAttribute', {
          name: 'sdks',
          value: mdastBuilder('mdxJsxAttributeValueExpression', {
            value: JSON.stringify(props.sdks),
          }),
        }),
        mdastBuilder('mdxJsxAttribute', {
          name: 'code',
          value: mdastBuilder('mdxJsxAttributeValueExpression', {
            value: props.code,
          }),
        }),
      ],
    })
  }

  return mdastBuilder('mdxJsxTextElement', {
    name: 'SDKLink',
    attributes: [
      mdastBuilder('mdxJsxAttribute', {
        name: 'href',
        value: props.href,
      }),
      mdastBuilder('mdxJsxAttribute', {
        name: 'sdks',
        value: mdastBuilder('mdxJsxAttributeValueExpression', {
          value: JSON.stringify(props.sdks),
        }),
      }),
    ],
    children: props.children,
  })
}

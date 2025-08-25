// Given a component name (eg <If />) and a prop name (eg sdk)
// this function will extract and return the value of the prop
// note that this won't further parse the value

import type { VFile } from 'vfile'
import type { BuildConfig } from '../config'
import type { Node } from 'unist'
import { safeMessage, type WarningsSection } from '../error-messages'
import { findComponent } from './findComponent'
import { z } from 'zod'

export const extractComponentPropValueFromNode = <Schema extends z.ZodType>(
  config: BuildConfig,
  node: Node,
  vfile: VFile | undefined,
  componentName: string,
  propName: string,
  required = true,
  section: WarningsSection,
  filePath: string,
  schema: Schema,
): z.infer<Schema> | undefined => {
  const component = findComponent(node, componentName)

  if (component === undefined) return undefined

  // Check for attributes
  if (!('attributes' in component)) {
    if (vfile) {
      safeMessage(config, vfile, filePath, section, 'component-no-props', [componentName], component.position)
    }
    return undefined
  }

  if (!Array.isArray(component.attributes)) {
    if (vfile) {
      safeMessage(
        config,
        vfile,
        filePath,
        section,
        'component-attributes-not-array',
        [componentName],
        component.position,
      )
    }
    return undefined
  }

  // Find the requested prop
  const propAttribute = component.attributes.find((attribute) => attribute.name === propName)

  if (propAttribute === undefined) {
    if (required === true && vfile) {
      safeMessage(
        config,
        vfile,
        filePath,
        section,
        'component-missing-attribute',
        [componentName, propName],
        component.position,
      )
    }
    return undefined
  }

  const value = propAttribute.value

  if (value === undefined) {
    if (required === true && vfile) {
      safeMessage(
        config,
        vfile,
        filePath,
        section,
        'component-attribute-no-value',
        [componentName, propName],
        component.position,
      )
    }
    return undefined
  }

  // Handle both string values and object values (like JSX expressions)
  if (typeof value === 'string') {
    return schema.parse(value)
  } else if (typeof value === 'object' && value === null) {
    // this is when a component is like <Select single />
    return schema.parse(true)
  } else if (typeof value === 'object' && 'value' in value) {
    return schema.parse(value.value)
  }

  if (vfile) {
    safeMessage(
      config,
      vfile,
      filePath,
      section,
      'component-attribute-unsupported-type',
      [componentName, propName],
      component.position,
    )
  }
  return undefined
}

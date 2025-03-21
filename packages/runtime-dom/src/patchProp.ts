import { patchClass } from './modules/class'
import { patchStyle } from './modules/style'
import { patchAttr } from './modules/attrs'
import { patchDOMProp } from './modules/props'
import { patchEvent } from './modules/events'
import {
  camelize,
  isFunction,
  isModelListener,
  isOn,
  isString,
} from '@vue/shared'
import type {
  ComponentInternalInstance,
  RendererOptions,
} from '@vue/runtime-core'
import type { VueElement } from './apiCustomElement'

const isNativeOn = (key: string) =>
  key.charCodeAt(0) === 111 /* o */ &&
  key.charCodeAt(1) === 110 /* n */ &&
  // lowercase letter
  key.charCodeAt(2) > 96 &&
  key.charCodeAt(2) < 123

type DOMRendererOptions = RendererOptions<Node, Element>

export const patchProp: DOMRendererOptions['patchProp'] = (
  el,
  key,
  prevValue,
  nextValue,
  namespace,
  parentComponent,
) => {
  const isSVG = namespace === 'svg'

  if (key === 'class') {
    patchClass(el, nextValue, isSVG)
    return
  }

  if (key === 'style') {
    patchStyle(el, prevValue, nextValue)
    return
  }

  if (isOn(key)) {
    // ignore v-model listeners
    if (!isModelListener(key)) {
      patchEvent(el, key, prevValue, nextValue, parentComponent)
    }
    return
  }

  const isPropShorthand = key.startsWith('.')
  const isAttrShorthand = key.startsWith('^')

  if (isPropShorthand || isAttrShorthand) {
    key = key.slice(1)
  }

  if (isPropShorthand) {
    const camelKey = camelize(key)
    const propKey = camelKey in el ? camelKey : key
    handleProp(el, propKey, key, nextValue, parentComponent, isSVG)
    return
  }

  if (!isAttrShorthand) {
    const result = shouldSetAsProp(el, key, nextValue, isSVG)
    if (result.isProp) {
      handleProp(el, result.propName, key, nextValue, parentComponent, isSVG)
      return
    }
  }

  if (
    // #11081 force set props for possible async custom element
    (el as VueElement)._isVueCE &&
    (/[A-Z]/.test(key) || !isString(nextValue))
  ) {
    patchDOMProp(el, camelize(key), nextValue, parentComponent, key)
    return
  }

  // special case for <input v-model type="checkbox"> with
  // :true-value & :false-value
  // store value as dom properties since non-string values will be
  // stringified.
  if (key === 'true-value') {
    ;(el as any)._trueValue = nextValue
  } else if (key === 'false-value') {
    ;(el as any)._falseValue = nextValue
  }
  patchAttr(el, key, nextValue, isSVG, parentComponent)
}

function handleProp(
  el: Element,
  propKey: string,
  attrKey: string,
  nextValue: any,
  parentComponent: ComponentInternalInstance | null | undefined,
  isSVG: boolean,
) {
  patchDOMProp(el, propKey, nextValue, parentComponent, attrKey)
  // #6007 also set form state as attributes so they work with
  // <input type="reset"> or libs / extensions that expect attributes
  // #11163 custom elements may use value as an prop and set it as object
  if (
    !el.tagName.includes('-') &&
    (attrKey === 'value' || attrKey === 'checked' || attrKey === 'selected')
  ) {
    patchAttr(
      el,
      attrKey,
      nextValue,
      isSVG,
      parentComponent,
      attrKey !== 'value',
    )
  }
}

function shouldSetAsProp(
  el: Element,
  key: string,
  value: unknown,
  isSVG: boolean,
): { isProp: boolean; propName: string } {
  const result = { isProp: false, propName: key }

  if (isSVG) {
    // most keys must be set as attribute on svg elements to work
    // ...except innerHTML & textContent
    if (key === 'innerHTML' || key === 'textContent') {
      result.isProp = true
      return result
    }
    // or native onclick with function values
    if (key in el && isNativeOn(key) && isFunction(value)) {
      result.isProp = true
      return result
    }
    return result
  }

  // these are enumerated attrs, however their corresponding DOM properties
  // are actually booleans - this leads to setting it with a string "false"
  // value leading it to be coerced to `true`, so we need to always treat
  // them as attributes.
  // Note that `contentEditable` doesn't have this problem: its DOM
  // property is also enumerated string values.
  if (key === 'spellcheck' || key === 'draggable' || key === 'translate') {
    return result
  }

  // #1787, #2840 form property on form elements is readonly and must be set as
  // attribute.
  if (key === 'form') {
    return result
  }

  // #1526 <input list> must be set as attribute
  if (key === 'list' && el.tagName === 'INPUT') {
    return result
  }

  // #2766 <textarea type> must be set as attribute
  if (key === 'type' && el.tagName === 'TEXTAREA') {
    return result
  }

  // #8780 the width or height of embedded tags must be set as attribute
  if (key === 'width' || key === 'height') {
    const tag = el.tagName
    if (
      tag === 'IMG' ||
      tag === 'VIDEO' ||
      tag === 'CANVAS' ||
      tag === 'SOURCE'
    ) {
      return result
    }
  }

  // native onclick with string value, must be set as attribute
  if (isNativeOn(key) && isString(value)) {
    return result
  }

  const camelKey = camelize(key)
  if (camelKey in el) {
    result.isProp = true
    result.propName = camelKey
    return result
  }

  result.isProp = key in el
  return result
}

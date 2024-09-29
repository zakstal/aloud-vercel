import { Tokens, tokenize } from './script-tokens'
import { useEffect, useState, useMemo } from 'react';
import { ScriptHistory } from './script-history-refactor'
// import { ScriptHistory } from './script-history'
import * as db from './storage'


/**
 * 
 * TODO/issues
 * - full line range and backspace dosen't work
 * - hlding backspace fore several lines puts the caret in the wrong spot on key up
 * - range selected and key press puts the caret in the wrong spot
 * - rang over lines with no text dosen't show a highlight. its confusing
 * - handle dual dialog in script-tokens
 * - handle cut, copy, paste over range
 * - handle enter and backspace causes a lot of updates from setting state. Merge for singluar updates.
 * - can this handle lots of data
 * - on removal of "character" type, update following "dialog" type to be just an action
 * - choose a name, focusId, orderId etc
 * - merge enter, backspace and  keypress into one update function
 * - remappable hotkeys for cut, copy and paste
 * - handle mouse paste and cut
 * - script history, caret is on a position, unfocus browser then refocus, the caret looses position
 * 
 * UPDATES
 * - saveing state in the browser. Indexd db?
 * - add caret position and order id to the script hitory db object so that on undo we can represent exaclty where the user was
 * 
 * Possible performance updates
 * - preact signals?
 * - windowing
 */

const noUpdateKyes = [
    'Tab',
    'CapsLock',
    'Shift',
    'Control',
    'Alt',
    'Meta',
    'ArrowLeft',
    'ArrowDown',
    'ArrowRight',
    'ArrowUp',
    'Escape',
    'F1',
    'F2',
    'F3',
    'F4',
    'F5',
    'F6',
    'F7',
    'F8',
]

//TODO use these form script history
const removeTokens = ['dialogue_end', 'dialogue_begin']

const prepareTokensRender = (tokens: Tokens[]) => {
    return tokens.filter((token: Tokens) => !removeTokens.includes(token.type))
}

const prepareTokensSave = (tokens: Tokens[]) => {
    // dialogue_end
    // dialogue_begin
}

const noUpdateKeySet = new Set(noUpdateKyes)

function getElementAtCaret() {
    const selection = window.getSelection();
    
    if (selection.rangeCount > 0) {
      const range = selection.getRangeAt(0);
      const caretNode = range.commonAncestorContainer;
  
      // If the caretNode is a text node, get its parent element
      return caretNode.nodeType === Node.TEXT_NODE ? caretNode.parentElement : caretNode;
    }
    
    return null;
}


window.scriptStorage = window.scriptStorage || new ScriptHistory()

export function useFountainNodes(tokensIn = [], versionNumber: string, pdfText) {

    const [tokens, setTokens] = useState(prepareTokensRender(tokensIn))
    const tokensChanged = useMemo(() => tokens, [tokens])
    const [nextCaretPosition, setNextCaretPosition] = useState([])
    const [currentOrderId, setCurrentOrderId] = useState(null)
    const [secondaryOrderId, setSecondaryOrderId] = useState(null) // for ranges
    const [rangeOffsets, setRangeOffsets] = useState(null) // for ranges
    const [slections, setSelections] = useState(null)

    useEffect(() => {
        console.log('pdfText', pdfText)
        if (!pdfText || tokensIn.length) return
        const [ didUpdate ] = window.scriptStorage.updateText({
            text: pdfText
        }, 0, 0)
        console.log('didUpdate', didUpdate)

        // This is to save updating. if we are not changing the type or the tranformation of the text,
        // we can just register the changeand if we rerender later, all the text will be updated.
        if (didUpdate) {
            window.scriptStorage.commit()
            // setNextCaretPosition(selection?.anchorOffset)
        }
    }, [pdfText])

    useEffect(() => {
        window.scriptStorage = window.scriptStorage || new ScriptHistory()
        // NB ScriptHistory has an internal representation of tokens. not sure if we should keep 
        // to sets, hoever we can change the internal as we like and only update it later if needed
        window.scriptStorage.setCallbackValues(
            versionNumber,
            db,
            (tokens: Tokens[], caretPosition: number | null, currentOrderId: number | null) => { // call back that runs on "commit"
                setTokens(tokens)
                caretPosition && setNextCaretPosition(caretPosition)
                currentOrderId && setCurrentOrderId(currentOrderId)
            },
            tokens,
        )

    }, [versionNumber])


    useEffect(() => {
        if (!currentOrderId) return

        const element = document.querySelector(`[data-order="${Number(currentOrderId)}"]`)
        if (!element && nextCaretPosition) return

        const range = document.createRange();
        const sel = window.getSelection();

        // this should handle tags that are empty but we still want the cursor
        const el = element?.childNodes[0] ? element?.childNodes[0] : element
        range.collapse(true);
        const textLength = element?.childNodes[0] ? element?.childNodes[0].length : element?.innerText?.length

        // caret can fail if there is a space character in the text. 
        // This is to handle situations where the nextCaretPosition is off for some reason.
        const caret = textLength < nextCaretPosition ? textLength : nextCaretPosition

        console.log('set range')
        try {
            if (el) {
                range.setStart(el, caret);
            }
        } catch(e) {
            console.error(e)
        }
            
        sel.removeAllRanges();
        sel.addRange(range);

        setNextCaretPosition(null)

    }, [tokensChanged])

    return [
        tokens,
        async function handleKeyDown(e) {
            const selection = window.getSelection();
            const currentElement = getElementAtCaret()
            const orderId = currentElement?.dataset?.order

            if (e.key === 'Tab' && orderId) {
                e.preventDefault()

                window.scriptStorage.modify({
                    type: 'character',
                }, orderId, selection?.anchorOffset)

                window.scriptStorage.commit()
                setCurrentOrderId(orderId)
                setNextCaretPosition(selection?.anchorOffset)
                return
            }
            const isMetaCopy = e.metaKey && e.key === 'c' 
            if (isMetaCopy) {
                // e.preventDefault()
                return 
            }

            const isCtrlUndo = e.ctrlKey && e.key === 'z' 
            const isMetalUndo = e.metaKey && e.key === 'z' 
            const isShift = e.shiftKey

            if (isCtrlUndo || isMetalUndo ) {
                e.preventDefault()
                if (isShift) {
                    await window.scriptStorage.redo()
                    return
                }
                await window.scriptStorage.undo()
                return
            }

            const isCtrlCut = e.ctrlKey && e.key === 'x' 
            const isMetalCut = e.metaKey && e.key === 'x' 
            if (isCtrlCut || isMetalCut) {
                return
            }
   
            if (!rangeOffsets) return
            if (e.shiftKey) return
            if (noUpdateKeySet.has(e.key)) return
            e.preventDefault()

            // hande range and key press
            const [currentOffset, secondOffset] = rangeOffsets || []
            const [carotPostiion, focusId, foundText] = window.scriptStorage.combineRange(Number(currentOrderId), Number(secondaryOrderId), currentOffset, secondOffset)

            setNextCaretPosition(selection?.anchorOffset)
            window.scriptStorage.commit()

           
  
            setCurrentOrderId(focusId)
            setNextCaretPosition(carotPostiion)
            setSecondaryOrderId(null)
            setRangeOffsets(null)
        },
        function handleKeyUp(e) {
            const isCtrlPaste = e.ctrlKey && e.key === 'v' 
            const isMetalPaste = e.metaKey && e.key === 'v' 
            if (isCtrlPaste || isMetalPaste) return

            const selection = window.getSelection();
            const currentElement = getElementAtCaret()
            const orderId = currentElement?.dataset?.order

            // setting the current orderid works best in keyUp rather than key down for some reason
            if (orderId) {
                setCurrentOrderId(orderId)
                setSecondaryOrderId(null)
            }

            if (noUpdateKeySet.has(e.key)) return
            if (e.keyCode === 32) return // space bar. having a space sometimes doesn't register in the inner text and setting the caret can fail
            if (orderId) {

                console.log('handleKeyUp currentElement.innerText', currentElement.innerText)
                const [ didUpdate ] = window.scriptStorage.updateText({
                    text: currentElement.innerText
                }, orderId, selection?.anchorOffset)

                console.log('didUpdate', didUpdate)

                // This is to save updating. if we are not changing the type or the tranformation of the text,
                // we can just register the changeand if we rerender later, all the text will be updated.
                if (didUpdate) {
                    window.scriptStorage.commit()
                    setNextCaretPosition(selection?.anchorOffset)
                }
            }
        },
        function handleOnEnter(e) {
            e.preventDefault()
            try {
                const selection = window.getSelection();

                let carotPostiion = 0
                let focusId = currentOrderId

                window.scriptStorage.combineSplitRange(focusId, carotPostiion || selection?.anchorOffset)
                window.scriptStorage.commit()

                setCurrentOrderId(Number(currentOrderId) + 1)
                setNextCaretPosition(0)
                setSecondaryOrderId(null)
                setRangeOffsets(null)


            } catch (e) {
                console.log('error', e)
            }
        },
        function handleOnBackSpace(e) {
            const selection = window.getSelection();
            
            if (selection.anchorOffset !== 0 && !rangeOffsets) return
            e.preventDefault()

            const [currentOffset, secondOffset] = rangeOffsets || []
            if (!currentOffset)
            try {
                const res = window.scriptStorage?.combineRange(Number(currentOrderId), Number(secondaryOrderId), currentOffset, secondOffset)
                console.log('res', res)
                const [carotPostiion, focusId] = res
                window.scriptStorage.commit()
                
                setCurrentOrderId(focusId)
                setNextCaretPosition(carotPostiion)
                setSecondaryOrderId(null)
                setRangeOffsets(null)
                // setTokens(newTokens)
            } catch(e) {
                console.log("error", e)
            }
        },
        function clearCurrrentNode() {
            setCurrentOrderId(null)
            setNextCaretPosition(null)
        },
        function setCurrentNode(e) {
            const orderId = e.target?.dataset?.order
            if (orderId) {
                setCurrentOrderId(orderId)
            }
        },
        function handleOnSelect(e) {
            const selection = window.getSelection();

            // selection.anchorNode // start node
            // selection.anchorOffset // start node cursor start
            // selection.extentNode // end node offset
            // selection.extentOffset // end node offset

            const acnchorNode = selection.anchorNode?.parentNode
            const extentNode = selection.extentNode?.parentNode

            const acnchorNodeOrder = acnchorNode?.dataset?.order
            const extentNodeOrder = extentNode?.dataset?.order

            if (acnchorNodeOrder != extentNodeOrder && acnchorNodeOrder != null &&  extentNodeOrder != null) {
                setCurrentOrderId(acnchorNodeOrder)
                setSecondaryOrderId(extentNodeOrder)

                setRangeOffsets([selection.anchorOffset, selection.extentOffset])
            }
        },
        function handlePaste(e) {
            e.preventDefault()
            const selection = window.getSelection();
            const currentElement = getElementAtCaret()
            const orderId = currentElement?.dataset?.order

            const [didUpdate, focusId, nextCaretPostion] = window.scriptStorage.updateText({
                text: e.clipboardData.getData('text/plain')
            }, orderId, selection?.anchorOffset)

            // This is to save updating. if we are not changing the type or the tranformation of the text,
            // we can just register the changeand if we rerender later, all the text will be updated.
            if (didUpdate) {
                window.scriptStorage.commit()
                setCurrentOrderId(focusId)
                setNextCaretPosition(nextCaretPostion)
            }

        },
        function handleCut(e) {
            const selection = window.getSelection();
            
            if (!rangeOffsets) return
            e.preventDefault()

            const [currentOffset, secondOffset] = rangeOffsets || []
            const [carotPostiion, focusId] = window.scriptStorage.combineRange(Number(currentOrderId), Number(secondaryOrderId), currentOffset, secondOffset)
            window.scriptStorage.commit()

            setCurrentOrderId(focusId)
            setNextCaretPosition(carotPostiion)
            setSecondaryOrderId(null)
            setRangeOffsets(null)
            // setTokens(newTokens)
        },
        currentOrderId,
        secondaryOrderId
    ]
}
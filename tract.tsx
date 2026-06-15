import { useEffect, useRef, MouseEvent, Dispatch, SetStateAction, useState } from "react";
import { RPTVoice } from "./rpt-voice";

export const Tract = (props: {voice: RPTVoice, style?: React.CSSProperties,
  setVowel?: Dispatch<SetStateAction<{i: number, d: number} | undefined>>,
  reportVowel?: boolean
}) => {

  const {voice, style, setVowel, reportVowel} = props

  const [tractVowel, setTractVowel] = useState<{i: number, d: number}>()
  
  const cnvRef = useRef<HTMLCanvasElement>(null)
  const animationRef = useRef(0)

  function getUIVowel() {
    const vowel = {
      i: voice.UI.normalizedTongueIndex(), 
      d: voice.UI.tongueDiameter,
    }
    setTractVowel(vowel)
    setVowel?.(vowel)
  }

  //on component mount, pass 2D render context to voice UI
  useEffect(() => {
    if (!cnvRef.current) return
    voice.UI.cnv = cnvRef.current
    voice.UI.ctx = cnvRef.current.getContext('2d')!

    function getNewFrame() {
      voice.UI.draw()
      animationRef.current = requestAnimationFrame(getNewFrame)
    }
    getNewFrame()
    getUIVowel?.()

    return () => cancelAnimationFrame(animationRef.current)
  }, [voice, cnvRef.current])

  function startMouse(e: MouseEvent) {
    e.preventDefault()
    voice.UI.startMouse(e)
    getUIVowel()
  }
  function endMouse() {
    voice.UI.endMouse()
  }
  function moveMouse(e: MouseEvent) {
    voice.UI.moveMouse(e)
    if (e.buttons) getUIVowel()
  }

  const vowelInfo = tractVowel && `Index: ${tractVowel.i.toFixed(2)}, Diameter: ${tractVowel.d.toFixed(2)}`

  return <canvas 
    className="tractCanvas" width={600} height={600} ref={cnvRef} 
    style={{...style, alignSelf: "center"}} onMouseDown={startMouse} onMouseUp={endMouse} onMouseMove={moveMouse}
    title={reportVowel ? vowelInfo : undefined}
  />
}

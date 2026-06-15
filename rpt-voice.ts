import { TractUI } from "./tract-ui"

export type RPTVoicePreset = {
  n: number
  frequency: number
  tenseness: number
  aspiration?: number
  eq?: [number, number]
  gain: number
  pan?: number
}

export class RPTVoice {
  static defaultPreset: RPTVoicePreset = {
    n: 44,
    frequency: 140,
    tenseness: 0.7,
    eq: [0, 0],
    gain: 1,
  };

  name: string | number;
  ctx: AudioContext;
  connected: boolean = false;

  glottis: AudioWorkletNode;
  tract: AudioWorkletNode;
  gainNode: GainNode;
  pannerNode: StereoPannerNode;
  noiseNode: AudioBufferSourceNode;
  aspirationNode: BiquadFilterNode;
  fricativeNode: BiquadFilterNode;
  eqFilterNodes: BiquadFilterNode[];

  tractN: AudioParam;
  frequency: AudioParam;
  aspirationIntensity: AudioParam;
  pitchbend: AudioParam;
  tractSpeed: AudioParam;

  fricativeIntensity: AudioParam;
  transientIntensity: AudioParam;
  tenseness: { base: AudioParam; mult: AudioParam };

  intensity: AudioParam;
  constriction: { index: AudioParam; diameter: AudioParam };
  tongue: { index: AudioParam; diameter: AudioParam };
  lipDiameter: AudioParam;
  velumTarget: AudioParam;

  d?: Float64Array;
  v: number = 0.01;

  UI: TractUI;

  //create a new voice using the given audiocontext and destinationNOde (default ctx destination)
  constructor(
    name: string | number,
    preset: RPTVoicePreset | null,
    ctx: AudioContext,
  ) {
    this.name = name;
    this.ctx = ctx;

    this.glottis = new AudioWorkletNode(this.ctx, "glottis", {
      numberOfInputs: 1, //aspiration noise
      numberOfOutputs: 3, //glottal source, aspiration, noise modulator
      outputChannelCount: [1, 1, 1],
      processorOptions: { name: this.name },
    });

    this.tract = new AudioWorkletNode(this.ctx, "tract", {
      numberOfInputs: 4, //glottal source, aspiration, fricative noise, noise modulator
      numberOfOutputs: 1,
      outputChannelCount: [1],
      processorOptions: { name: this.name },
    });

    this.tractN = this.tract.parameters.get("n")!;
    this.frequency = this.glottis.parameters.get("frequency")!;
    this.intensity = this.glottis.parameters.get("intensity")!;
    this.aspirationIntensity = this.glottis.parameters.get("aspiration")!;
    this.fricativeIntensity = this.tract.parameters.get("fricatives")!;
    this.transientIntensity = this.tract.parameters.get("transients")!;
    this.pitchbend = this.glottis.parameters.get("pitchbend")!;
    this.tenseness = {
      base: this.glottis.parameters.get("tenseness")!,
      mult: this.glottis.parameters.get("tenseness-mult")!,
    };
    this.tractSpeed = this.tract.parameters.get("movement-speed")!;
    this.constriction = {
      index: this.tract.parameters.get("constriction-index")!,
      diameter: this.tract.parameters.get("constriction-diameter")!,
    };
    this.tongue = {
      index: this.tract.parameters.get("tongue-index")!,
      diameter: this.tract.parameters.get("tongue-diameter")!,
    };
    this.lipDiameter = this.tract.parameters.get("lip-diameter")!;
    this.velumTarget = this.tract.parameters.get("velum-target")!;

    this.gainNode = new GainNode(this.ctx, { gain: 1 });
    this.pannerNode = new StereoPannerNode(this.ctx, { pan: 0 });

    this.tract.port.onmessage = (e) => {
      this.d = e.data.d;
      this.v = e.data.v;
    };

    const sampleRate = this.ctx.sampleRate;
    const buf = this.ctx.createBuffer(1, sampleRate * 2, sampleRate);
    const bufSamps = buf.getChannelData(0);
    for (let i = 0; i < sampleRate * 2; i++) {
      bufSamps[i] = Math.random();
    }

    this.noiseNode = this.ctx.createBufferSource();
    this.noiseNode.buffer = buf;
    this.noiseNode.loop = true;
    this.noiseNode.start();

    this.aspirationNode = this.ctx.createBiquadFilter();
    this.aspirationNode.type = "bandpass";
    this.aspirationNode.frequency.value = 500;
    this.aspirationNode.Q.value = 0.5;

    this.fricativeNode = this.ctx.createBiquadFilter();
    this.fricativeNode.type = "bandpass";
    this.fricativeNode.frequency.value = 1000;
    this.fricativeNode.Q.value = 0.5;

    const filterCount = 2;
    this.eqFilterNodes = new Array(filterCount)
      .fill(undefined)
      .map(
        (_, i) =>
          new BiquadFilterNode(this.ctx, {
            Q: 0.431516,
            type:
              i == 0
                ? "lowshelf"
                : i == filterCount - 1
                  ? "highshelf"
                  : "peaking",
            frequency: [100, 3900][i],
          }),
      );

    if (preset) this.setPreset(preset);
    this.UI = new TractUI(this);
  }

  /*
  RPT Voice DSP chain:
      Glottis 
          Inputs: Aspiration noise source
          Outputs
              glottal source -> EQ eqFilterNodes -> tract glottal source
              aspiration -> tract aspiration
              noise modulator -> tract noise modulator
      Tract 
          Inputs: glottal source, aspiration, fricative noise source, noiseModulator
          Outputs
              filtered voice -> gain -> pan -> destination        
  */
  connect(destination: AudioNode) {
    this.disconnect();

    //connect noise source to aspiration + fricative eqFilterNodes
    this.noiseNode.connect(this.aspirationNode);
    this.noiseNode.connect(this.fricativeNode);

    this.aspirationNode.connect(this.glottis, 0, 0); //aspiration noise source -> glottis aspiration

    this.glottis.connect(this.eqFilterNodes[0], 0, 0); //glottis glottal source -> EQ eqFilterNodes
    for (let i = 1; i < this.eqFilterNodes.length; i++) {
      //daisy-chain EQ eqFilterNodes
      this.eqFilterNodes[i - 1].connect(this.eqFilterNodes[i]);
    }
    this.eqFilterNodes[this.eqFilterNodes.length - 1].connect(this.tract, 0, 0); //EQ eqFilterNodes -> tract glottal source

    this.glottis.connect(this.tract, 1, 1); //glottis aspiration -> tract aspiration
    this.fricativeNode.connect(this.tract, 0, 2); //fricative noise source -> tract fricative
    this.glottis.connect(this.tract, 2, 3); //glottis noiseModulator -> tract noiseModulator

    this.tract.connect(this.gainNode);
    this.gainNode.connect(this.pannerNode);
    this.pannerNode.connect(destination);
    this.connected = true;
  }

  disconnect() {
    this.connected = false;
    this.noiseNode.disconnect();
    this.aspirationNode.disconnect();
    this.fricativeNode.disconnect();
    this.glottis.disconnect();
    this.eqFilterNodes.forEach((f) => f.disconnect());
    this.tract.disconnect();
    this.gainNode.disconnect();
    this.pannerNode.disconnect();
  }

  setGain(gain: number) {
    this.gainNode.gain.value = gain;
  }

  setPanning(pan: number) {
    this.pannerNode.pan.value = pan;
  }

  setPreset(preset: RPTVoicePreset) {
    this.setFrequency(preset.frequency);
    this.tenseness.base.value = preset.tenseness;
    this.setN(preset.n);
    this.eqFilterNodes.forEach((f) => (f.gain.value = 0));
    preset.eq?.forEach((f, i) => (this.eqFilterNodes[i].gain.value = f));
    this.setGain(preset.gain ?? 1);
    this.aspirationIntensity.value = preset.aspiration ?? 1;
    this.setPanning(preset.pan || 0);
  }

  setTongueIndex(i: number) {
    this.tongue.index.value = i;
    this.UI.tongueIndex = this.UI.tongueIndexFromNormalized(i);
  }

  setTongueDiameter(d: number) {
    this.tongue.diameter.value = d;
    this.UI.tongueDiameter = d;
  }

  setN(n: number) {
    this.tractN.value = n;
    this.UI.init(n);
  }

  setFrequency(f: number) {
    this.frequency.value = f;
    for (let i = 0; i < this.eqFilterNodes.length; i++) {
      this.eqFilterNodes[i].frequency.value = f * Math.pow(1.259921, i);
    }
  }

  reset() {
    [this.glottis, this.tract].forEach((node) =>
      node.parameters.forEach((param) => (param.value = param.defaultValue)),
    )
  }
}

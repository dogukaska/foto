import * as ort from "../vendor/ort/ort.webgpu.bundle.min.mjs";

ort.env.wasm.wasmPaths = new URL("../vendor/ort/", import.meta.url).href;
ort.env.wasm.numThreads = 1;
ort.env.logLevel = "error";

const W = 320, H = 240, AREA = W * H;
const model = new URL("./model/face-rfb-320.onnx", import.meta.url);
const clamp = n => Math.min(1, Math.max(0,n));

function overlap(a,b) {
  const w = Math.max(0,Math.min(a.right,b.right)-Math.max(a.left,b.left));
  const h = Math.max(0,Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top));
  const area = w*h;
  return area / ((a.right-a.left)*(a.bottom-a.top)+(b.right-b.left)*(b.bottom-b.top)-area);
}

self.onmessage = async ({data:pixels}) => {
  let session;
  try {
    const tensor = new Float32Array(AREA * 3);
    for(let i=0;i<AREA;i++) {
      tensor[i]=(pixels[4*i]-127)/128;
      tensor[i+AREA]=(pixels[4*i+1]-127)/128;
      tensor[i+2*AREA]=(pixels[4*i+2]-127)/128;
    }
    session = await ort.InferenceSession.create(model.href,{executionProviders:["wasm"],logSeverityLevel:3});
    const output = await session.run({[session.inputNames[0]]:new ort.Tensor("float32",tensor,[1,3,H,W])});
    const boxes=output.boxes.data, scores=output.scores.data, ranked=[];
    for(let i=0;i<scores.length/2;i++) {
      const score=scores[2*i+1];
      if(score<.68) continue;
      const [left,top,right,bottom]=boxes.subarray(4*i,4*i+4).map(clamp);
      if(right>left&&bottom>top) ranked.push({left,top,right,bottom,score});
    }
    ranked.sort((a,b)=>b.score-a.score);
    const selected=[];
    for(const candidate of ranked) {
      if(selected.every(box=>overlap(candidate,box)<.35)) selected.push(candidate);
      if(selected.length===30) break;
    }
    self.postMessage({boxes:selected});
  } catch(error) {
    console.error(error);
    self.postMessage({error:true});
  } finally {
    await session?.release().catch(()=>{});
  }
};

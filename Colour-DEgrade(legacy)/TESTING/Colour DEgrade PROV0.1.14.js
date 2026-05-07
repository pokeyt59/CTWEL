
// Colour DEgrade — Colour Lab V3 Compatible (Text Version)
// Includes ordered dithering, tile-based diffusion, palette support, and optional worker parallelism

(function (Scratch) {
"use strict";

if (!Scratch.extensions.unsandboxed) {
  throw new Error("Colour DEgrade must run unsandboxed.");
}

// ===== Helpers =====
function clamp255(v){ return v<0?0:v>255?255:v|0; }

const BAYER = [
 [0,8,2,10],
 [12,4,14,6],
 [3,11,1,9],
 [15,7,13,5]
];

function nearestPalette(r,g,b,p){
 let best=0,bd=1e9;
 for(let i=0;i<p.length;i++){
  let dr=r-p[i][0],dg=g-p[i][1],db=b-p[i][2];
  let d=dr*dr+dg*dg+db*db;
  if(d<bd){bd=d;best=i;}
 }
 return p[best];
}

// ===== Worker Pool =====
const WORKERS=[];
const WORKER_COUNT=Math.max(2,Math.min(4,navigator.hardwareConcurrency||2));

function makeWorker(){
 const blob=new Blob([`
  onmessage=function(e){
   const {buf,w,h,start,end,levels,strength,palette}=e.data;
   const data=new Uint8ClampedArray(buf);
   const inv=levels-1;
   const TILE=32;

   function clamp(v){return v<0?0:v>255?255:v|0;}

   function nearest(r,g,b,p){
    let best=0,bd=1e9;
    for(let i=0;i<p.length;i++){
     let dr=r-p[i][0],dg=g-p[i][1],db=b-p[i][2];
     let d=dr*dr+dg*dg+db*db;
     if(d<bd){bd=d;best=i;}
    }
    return p[best];
   }

   for(let t=start;t<end;t++){
    const tilesX=Math.ceil(w/TILE);
    const ty=Math.floor(t/tilesX)*TILE;
    const tx=(t%tilesX)*TILE;

    const maxY=Math.min(ty+TILE,h);
    const maxX=Math.min(tx+TILE,w);

    for(let y=ty;y<maxY;y++){
     for(let x=tx;x<maxX;x++){
      const i=(y*w+x)*4;
      if(data[i+3]===0) continue;

      let r=data[i],g=data[i+1],b=data[i+2];

      let nr,ng,nb;
      if(palette){
        const c=nearest(r,g,b,palette);
        nr=c[0];ng=c[1];nb=c[2];
      }else{
        nr=((r/255*inv+0.5)|0)/inv*255;
        ng=((g/255*inv+0.5)|0)/inv*255;
        nb=((b/255*inv+0.5)|0)/inv*255;
      }

      data[i]=nr;data[i+1]=ng;data[i+2]=nb;

      const er=(r-nr)*strength;
      const eg=(g-ng)*strength;
      const eb=(b-nb)*strength;

      function spread(px,py,f){
        if(px<tx||px>=maxX||py<ty||py>=maxY) return;
        const idx=(py*w+px)*4;
        data[idx]=clamp(data[idx]+er*f);
        data[idx+1]=clamp(data[idx+1]+eg*f);
        data[idx+2]=clamp(data[idx+2]+eb*f);
      }

      spread(x+1,y,7/16);
      spread(x-1,y+1,3/16);
      spread(x,y+1,5/16);
      spread(x+1,y+1,1/16);
     }
    }
   }

   postMessage(buf,[buf]);
  }
 `],{type:"application/javascript"});

 return new Worker(URL.createObjectURL(blob));
}

function initWorkers(){
 if(WORKERS.length) return;
 for(let i=0;i<WORKER_COUNT;i++){
  WORKERS.push(makeWorker());
 }
}

// ===== Core Extension =====
class ColourDEgrade {
 constructor(runtime){ this.runtime=runtime; }

 getInfo(){
  return {
    id:"colourDEgrade",
    name:"Colour DEgrade",
    blocks:[
      {
        opcode:"dither",
        blockType:Scratch.BlockType.COMMAND,
        text:"dither [TARGET] mode [MODE] levels [L] strength [S] workers [W]",
        arguments:{
          TARGET:{type:Scratch.ArgumentType.STRING,defaultValue:"_myself_"},
          MODE:{type:Scratch.ArgumentType.STRING,menu:"mode"},
          L:{type:Scratch.ArgumentType.NUMBER,defaultValue:4},
          S:{type:Scratch.ArgumentType.NUMBER,defaultValue:1},
          W:{type:Scratch.ArgumentType.NUMBER,defaultValue:2}
        }
      },
      {
        opcode:"ditherPalette",
        blockType:Scratch.BlockType.COMMAND,
        text:"dither [TARGET] with palette [P] mode [MODE]",
        arguments:{
          TARGET:{type:Scratch.ArgumentType.STRING,defaultValue:"_myself_"},
          P:{type:Scratch.ArgumentType.STRING,defaultValue:"#000000,#ffffff"},
          MODE:{type:Scratch.ArgumentType.STRING,menu:"mode"}
        }
      },
      {
        opcode:"resetSprite",
        blockType:Scratch.BlockType.COMMAND,
        text:"reset sprite [TARGET]",
        arguments:{
          TARGET:{type:Scratch.ArgumentType.STRING,defaultValue:"_myself_"}
        }
      }
    ],
    menus:{
      mode:["ordered","diffusion"]
    }
  };
}
 async dither(args,util){
  const target=util.target;
  const renderer=this.runtime.renderer;
  const skin=renderer._allDrawables[target.drawableID]._skin;

  const canvas=skin._canvas;
  const ctx=canvas.getContext("2d",{willReadFrequently:true});
  const img=ctx.getImageData(0,0,canvas.width,canvas.height);

  const src=new Uint8ClampedArray(img.data);
  const w=img.width,h=img.height;

  if(args.MODE==="ordered"){
    const inv=args.L-1;
    for(let y=0;y<h;y++){
     for(let x=0;x<w;x++){
      const i=(y*w+x)*4;
      if(src[i+3]===0) continue;

      const t=(BAYER[y&3][x&3]/16-0.5)*args.S;

      let r=src[i]/255+t;
      let g=src[i+1]/255+t;
      let b=src[i+2]/255+t;

      r=Math.max(0,Math.min(1,r));
      g=Math.max(0,Math.min(1,g));
      b=Math.max(0,Math.min(1,b));

      src[i]=clamp255((Math.round(r*inv)/inv)*255);
      src[i+1]=clamp255((Math.round(g*inv)/inv)*255);
      src[i+2]=clamp255((Math.round(b*inv)/inv)*255);
     }
    }
  } else {

    if(args.W>1 && typeof Worker!=="undefined"){
      initWorkers();

      const tilesX=Math.ceil(w/32);
      const tilesY=Math.ceil(h/32);
      const total=tilesX*tilesY;

      const per=Math.ceil(total/WORKERS.length);

      let buffer=src.buffer;

      const results=await Promise.all(WORKERS.map((wk,i)=>{
        return new Promise(res=>{
          const s=i*per;
          const e=Math.min(s+per,total);
          if(s>=e) return res(buffer);

          wk.onmessage=(ev)=>res(ev.data);

          wk.postMessage({
            buf:buffer,w,h,start:s,end:e,
            levels:args.L,strength:args.S,palette:null
          },[buffer]);
        });
      }));

      src.set(new Uint8ClampedArray(results[results.length-1]));
    }
  }

  const out=new ImageData(src,w,h);
  const c=document.createElement("canvas");
  c.width=w;c.height=h;
  c.getContext("2d").putImageData(out,0,0);

  const id=renderer.createBitmapSkin(c,1);
  renderer.updateDrawableSkinId(target.drawableID,id);
 }
}

Scratch.extensions.register(new ColourDEgrade(Scratch.vm.runtime));

})(Scratch);

import React,{useLayoutEffect,useRef} from 'react';
import {TimelinePosition} from './timeline-position';
export function Timeline({children,className='timeline',forceLatest=0}:{children:React.ReactNode;className?:string;forceLatest?:number}){
  const node=useRef<HTMLDivElement>(null),content=useRef<HTMLDivElement>(null),position=useRef(new TimelinePosition()),lastForce=useRef(forceLatest);
  useLayoutEffect(()=>{if(!node.current)return;if(lastForce.current!==forceLatest){position.current.latest();lastForce.current=forceLatest;}position.current.restore(node.current);});
  useLayoutEffect(()=>{if(!node.current||!content.current)return;const observer=new ResizeObserver(()=>{if(node.current)position.current.restore(node.current);});observer.observe(content.current);return()=>observer.disconnect();},[]);
  return <div className={className} ref={node} onScroll={()=>{if(node.current)position.current.capture(node.current);}}><div ref={content}>{children}</div></div>;
}

/** Preserve a visible message's offset rather than just the total scroll height. */
export class TimelinePosition {
  private follow=true;
  private anchor:{id:string;offset:number}|null=null;
  private top=0;
  latest(){this.follow=true;this.anchor=null;}
  private remember(node:HTMLElement){
    this.top=node.scrollTop;const top=node.getBoundingClientRect().top;
    const item=Array.from(node.querySelectorAll<HTMLElement>('[data-message-id]')).find(item=>item.getBoundingClientRect().bottom>top);
    this.anchor=item?{id:item.dataset.messageId!,offset:item.getBoundingClientRect().top-top}:null;
  }
  capture(node:HTMLElement){this.follow=node.scrollHeight-node.clientHeight-node.scrollTop<80;this.remember(node);}
  restore(node:HTMLElement){
    if(this.follow)node.scrollTop=node.scrollHeight;
    else{const anchor=this.anchor;const item=anchor?Array.from(node.querySelectorAll<HTMLElement>('[data-message-id]')).find(item=>item.dataset.messageId===anchor.id):null;
      if(item&&anchor)node.scrollTop+=item.getBoundingClientRect().top-node.getBoundingClientRect().top-anchor.offset;
      else node.scrollTop=this.top;
    }
    this.remember(node);
  }
}

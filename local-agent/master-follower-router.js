/**
 * Opt-in master/follower action router for local Android device sessions.
 * Integration with authenticated device transports is intentionally separate.
 * Never broadcast raw key presses, secrets, or untrusted commands.
 */
class MasterFollowerRouter {
  constructor() { this.master = null; this.followers = new Map(); this.enabled = false; }
  setMaster(id) { if (typeof id !== 'string' || !id.trim()) throw Error('Device id required'); this.master = id; this.enabled = false; }
  addFollower(id, sender, dimensions) {
    if (!this.master || id === this.master) throw Error('Choose a different master');
    if (typeof sender !== 'function') throw Error('Sender required');
    if (!dimensions || dimensions.width <= 0 || dimensions.height <= 0) throw Error('Valid dimensions required');
    this.followers.set(id, {sender, dimensions, enabled:false});
  }
  setFollowerEnabled(id, enabled) { const item=this.followers.get(id); if (!item) throw Error('Unknown follower'); item.enabled=Boolean(enabled); }
  start() { if (!this.master) throw Error('Select master first'); this.enabled=true; }
  stop() { this.enabled=false; }
  removeFollower(id) { this.followers.delete(id); }
  async forward(sourceId, action) {
    if (!this.enabled || sourceId !== this.master) return [];
    if (!action || !['tap','swipe'].includes(action.type)) throw Error('Unsupported action');
    const points=action.type==='tap'?[action.at]:[action.from,action.to];
    if (!points.every(p=>p && Number.isFinite(p.x) && Number.isFinite(p.y) && p.x>=0 && p.x<=1 && p.y>=0 && p.y<=1)) throw Error('Normalized coordinates must be between 0 and 1');
    const results=[];
    for (const [id,follower] of this.followers) {
      if (!follower.enabled) continue;
      const point=p=>({x:Math.round(p.x*follower.dimensions.width),y:Math.round(p.y*follower.dimensions.height)});
      const mapped=action.type==='tap'?{type:'tap',at:point(action.at)}:{type:'swipe',from:point(action.from),to:point(action.to),durationMs:Math.max(100,Math.min(2000,Number(action.durationMs)||300))};
      try { await follower.sender(mapped); results.push({id,ok:true}); } catch(e) { results.push({id,ok:false,error:String(e)}); }
    }
    return results;
  }
}
module.exports={MasterFollowerRouter};

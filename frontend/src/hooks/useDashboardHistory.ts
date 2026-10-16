import { useCallback, useReducer } from 'react';
import type { SetStateAction } from 'react';
import type { PositionedWidget } from '../lib/dashboardLayout';
interface State<T> { current:T[]; past:T[][]; future:T[][] }
type Action<T> = {type:'reset';value:T[]} | {type:'set';value:SetStateAction<T[]>} | {type:'undo'|'redo'};
function reducer<T>(state:State<T>,action:Action<T>):State<T> {
  if(action.type==='reset') return {current:action.value,past:[],future:[]};
  if(action.type==='set') {
    const value=typeof action.value==='function'?action.value(state.current):action.value;
    if(JSON.stringify(value)===JSON.stringify(state.current))return state;
    return {current:value,past:[...state.past,state.current].slice(-50),future:[]};
  }
  if(action.type==='undo' && state.past.length) return {current:state.past[state.past.length-1],past:state.past.slice(0,-1),future:[state.current,...state.future]};
  if(action.type==='redo' && state.future.length) return {current:state.future[0],past:[...state.past,state.current].slice(-50),future:state.future.slice(1)};
  return state;
}
export function useDashboardHistory<T extends PositionedWidget>() {
  const [state,dispatch]=useReducer(reducer<T>,{current:[],past:[],future:[]});
  const set=useCallback((value:SetStateAction<T[]>)=>dispatch({type:'set',value}),[]);
  const reset=useCallback((value:T[])=>dispatch({type:'reset',value}),[]);
  return {previous:state.past.at(-1),next:state.future[0],widgets:state.current,set,reset,undo:()=>dispatch({type:'undo'}),redo:()=>dispatch({type:'redo'}),canUndo:state.past.length>0,canRedo:state.future.length>0};
}

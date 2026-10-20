import {getDatabase} from '@netlify/database';
import {getStore} from '@netlify/blobs';
// Adapt the existing cloud contract to Postgres and immutable Netlify objects.
export function storageBindings(env) {
    const db=getDatabase(),store=getStore('canvas-snapshots');
    return {...env,DB:{prepare(query){return {bind(...values){
        let index=0;const sql=query.replace(/\?/g,()=>'$'+(++index));
        return {
            async first(){return (await db.sql.unsafe(sql,values))[0]||null;},
            async all(){return {results:await db.sql.unsafe(sql,values)};},
            async run(){const rows=await db.sql.unsafe(sql+' RETURNING id',values);return {meta:{changes:rows.length}};},
        };
    }};}},BUCKET:{
        async put(key,value){await store.set(key,value);},
        async get(key){const data=await store.get(key,{type:'json',consistency:'strong'});return data===null?null:{async json(){return data;}};},
        async delete(key){await store.delete(key);},
    }};
}

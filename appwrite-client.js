import {Client, Account, Databases, Storage, ID, Query} from './vendor/appwrite.js';

export const config = await fetch('./appwrite-config.json', {cache:'no-store'}).then(r=>{if(!r.ok)throw new Error('Configuration unavailable');return r.json();});
export function isConfigured(){return config.enabled===true && /^https:\/\//.test(config.endpoint||'') && Boolean(config.projectId);}
const client=new Client();
if(isConfigured())client.setEndpoint(config.endpoint).setProject(config.projectId);
const account=new Account(client), db=new Databases(client), storage=new Storage(client);
function ready(){if(!isConfigured())throw new Error('Appwrite is not connected yet. Please use WhatsApp or email for now.');}
export async function request(path,{method='GET',body}={}){ready();if(!path.startsWith('/'))throw new Error('Invalid API path');return client.call(method.toLowerCase(),new URL(config.endpoint+path),{'content-type':'application/json'},body||{});}
export async function login(email,password){ready();return account.createEmailPasswordSession({email,password});}
export async function currentUser(){ready();return account.get();}
export async function logout(){ready();return account.deleteSession({sessionId:'current'});}
export async function getContent(){ready();const doc=await db.getDocument({databaseId:config.databaseId,collectionId:config.contentCollectionId,documentId:'site'});return JSON.parse(doc.payload);}
export async function saveContent(content){ready();const payload=JSON.stringify(content);if(new TextEncoder().encode(payload).length>65000)throw new Error('Content is too large. Please shorten text or remove unused items.');return db.updateDocument({databaseId:config.databaseId,collectionId:config.contentCollectionId,documentId:'site',data:{payload}});}
export async function sendMessage({name,email,message}){ready();name=String(name).trim();email=String(email).trim();message=String(message).trim();if(!name||name.length>120||!email||email.length>254||!message||message.length>5000)throw new Error('Please complete all fields within the displayed limits.');return db.createDocument({databaseId:config.databaseId,collectionId:config.messagesCollectionId,documentId:ID.unique(),data:{name,email,message,status:'new'},permissions:[]});}
export async function listMessages(){ready();const documents=[];let page;do{page=await db.listDocuments({databaseId:config.databaseId,collectionId:config.messagesCollectionId,queries:[Query.orderDesc('$createdAt'),Query.limit(100),Query.offset(documents.length)]});documents.push(...page.documents);}while(page.documents.length&&documents.length<page.total);return {documents,total:documents.length};}
export async function updateMessage(id,status){ready();if(!['new','read','replied','archived'].includes(status))throw new Error('Invalid message status');return db.updateDocument({databaseId:config.databaseId,collectionId:config.messagesCollectionId,documentId:id,data:{status}});}
export async function deleteMessage(id){ready();return db.deleteDocument({databaseId:config.databaseId,collectionId:config.messagesCollectionId,documentId:id});}
export async function uploadMedia(file){ready();const ext=file.name.split('.').pop().toLowerCase();if(!['jpg','jpeg','png','webp','gif','mp4','webm'].includes(ext)||file.size>10*1024*1024)throw new Error('Choose a JPG, PNG, WebP, GIF, MP4 or WebM file up to 10 MB.');return storage.createFile({bucketId:config.bucketId,fileId:ID.unique(),file});}
export async function listMedia(){ready();const files=[];let page;do{page=await storage.listFiles({bucketId:config.bucketId,queries:[Query.orderDesc('$createdAt'),Query.limit(100),Query.offset(files.length)]});files.push(...page.files);}while(page.files.length&&files.length<page.total);return {files,total:files.length};}
export function fileUrl(id){ready();return String(storage.getFileView({bucketId:config.bucketId,fileId:id}));}
export async function deleteMedia(id){ready();return storage.deleteFile({bucketId:config.bucketId,fileId:id});}

export async function requestPasswordRecovery(email){ready();const url=new URL('./admin.html',location.href);return account.createRecovery({email,url:url.href});}
export async function completePasswordRecovery(userId,secret,password){ready();return account.updateRecovery({userId,secret,password});}

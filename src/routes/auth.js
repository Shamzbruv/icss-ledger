const express = require('express');
module.exports = function authRoutes({ getConfig, createAuthClient, verifyToken, basePath = '' }) {
    const router = express.Router();
    router.use((req,res,next)=>{res.set('Cache-Control','no-store');next();});
    router.get('/config',(req,res)=>{
        try { res.json(getConfig()); }
        catch { res.status(503).json({error:'The Command Center authentication configuration is unavailable. Please contact the administrator.'}); }
    });
    router.post('/login',async(req,res)=>{
        const {email,password}=req.body||{};
        if(typeof email!=='string'||typeof password!=='string'||!email.trim()||!password||email.length>254||password.length>1024)return res.status(400).json({error:'Enter your email address and password.'});
        try {
            // A fresh public-key client per attempt prevents a login from changing
            // the privileged database client's active session or another user's login.
            const client=createAuthClient();
            const {data,error}=await client.auth.signInWithPassword({email:email.trim(),password});
            if(error){
                if(Number(error.status)>=500||!error.status||error.name==='AuthRetryableFetchError')return res.status(503).json({error:'The authentication service is unavailable. The ICSS Supabase project may be paused or inactive. Your password has not been changed.'});
                if(error.code==='email_not_confirmed')return res.status(401).json({error:'Confirm your email address before signing in.'});
                return res.status(401).json({error:'The email address or password is incorrect.'});
            }
            if(!data?.session?.access_token||!data.session.refresh_token)return res.status(503).json({error:'The authentication service did not return a session. Please try again.'});
            res.json({success:true,session:data.session,redirect:`${basePath}/dashboard`});
        }catch{res.status(503).json({error:'The authentication service could not be reached. Please check that the ICSS Supabase project is active and try again.'});}
    });
    router.get('/check',async(req,res)=>{
        const token=(req.headers.authorization||'').startsWith('Bearer ')?req.headers.authorization.slice(7):null;
        if(!token)return res.json({authenticated:false});
        try{const user=await verifyToken(token);res.json(user?{authenticated:true,user:{id:user.id,email:user.email}}:{authenticated:false});}
        catch{res.status(503).json({authenticated:false,error:'Authentication is temporarily unavailable.'});}
    });
    return router;
};

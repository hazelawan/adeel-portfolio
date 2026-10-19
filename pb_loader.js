(function(){
  try{
    var b64 = window.PB0+window.PB1+window.PB2+window.PB3+window.PB4+window.PB5;
    var bin = atob(b64);
    var arr = new Uint8Array(bin.length);
    for(var i=0;i<bin.length;i++) arr[i]=bin.charCodeAt(i);
    var blob = new Blob([arr],{type:'video/mp4'});
    var url = URL.createObjectURL(blob);
    var v = document.getElementById('avatarVideo');
    if(v){ v.src=url; v.load(); }
  }catch(e){ console.log('pb loader fail', e); }
})();
const d=await fetch('./site-content.json').then(r=>r.json());document.querySelector('#title').textContent=d.owner.name;document.querySelector('#message').textContent=d.hero.intro;

import os

categories = {
    'r-lib': 'r-lib Packages',
    'r-spatial': 'r-spatial Packages',
    'remote-sensing': 'Remote Sensing Packages',
    'reporting': 'Reporting Packages',
    'ropensci': 'rOpenSci Packages',
    'shiny': 'Shiny Packages',
    'social-science': 'Social Science Packages',
    'spatial-analysis': 'Spatial Analysis Packages',
    'spatial': 'Spatial Packages',
    'sports-analytics': 'Sports Analytics Packages',
    'stan': 'Stan Packages',
    'statistical-modeling': 'Statistical Modeling Packages',
    'statistics': 'Statistics Packages',
    'testing': 'Testing Packages',
    'text-mining': 'Text Mining Packages',
    'tidyverse': 'Tidyverse Packages',
    'time-series': 'Time Series Packages',
    'visualization': 'Visualization Packages',
    'web-scraping': 'Web Scraping Packages'
}

template = '''---
title: "{title}"
format:
  html:
    include-in-header:
      text: |
        <style>
        .letter-btn {{ background: none; border: none; color: #666; cursor: pointer; font-weight: 500; padding: 0 4px; font-size: 0.9rem; }}
        .letter-btn:hover {{ color: #333; }}
        .letter-btn.active {{ color: #000; font-weight: 700; }}
        #package-search {{ width: 100%; max-width: 400px; padding: 8px 12px; border: 1px solid #ccc; border-radius: 4px; font-size: 1rem; margin-bottom: 1em; }}
        </style>
---

```{{=html}}
<input type="text" id="package-search" placeholder="Search packages..." />
<div id="alphabet-filter" style="margin: 0.5em 0;"></div>
<div id="category-packages">Loading packages...</div>

<script>
document.addEventListener('DOMContentLoaded', function() {{
  var container = document.getElementById('category-packages');
  var searchInput = document.getElementById('package-search');
  var alphabetContainer = document.getElementById('alphabet-filter');

  var packages = [];
  var activeLetter = null;

  function renderPackages(list) {{
    var html = '<p class="results-count">Found ' + list.length + ' packages</p><div class="package-list">';
    for (var i = 0; i < Math.min(list.length, 50); i++) {{
      var pkg = list[i];
      html += '<div class="package-card">';
      html += '<div class="package-header">';
      html += '<h3 class="package-title"><a href="' + (pkg.url || '#') + '" target="_blank">' + pkg.package_name + '</a></h3>';
      html += '<span class="package-score">' + (typeof pkg.score === 'number' ? pkg.score.toFixed(1) : 'N/A') + '</span>';
      html += '</div>';
      html += '<p class="package-description">' + (pkg.title || 'No description') + '</p>';
      html += '</div>';
    }}
    html += '</div>';
    container.innerHTML = html;
  }}

  function applyFilters() {{
    var query = searchInput.value.trim().toLowerCase();
    var filtered = packages.slice();

    if (activeLetter) {{
      filtered = filtered.filter(function(pkg) {{
        return pkg.package_name.charAt(0).toUpperCase() === activeLetter;
      }});
    }}
    if (query) {{
      filtered = filtered.filter(function(pkg) {{
        return pkg.package_name.toLowerCase().indexOf(query) >= 0;
      }});
    }}
    renderPackages(filtered);
  }}

  fetch('../data/categories/{category}.json')
    .then(function(response) {{
      return response.json();
    }})
    .then(function(data) {{
      packages = data;

      var letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
      var btns = '';
      for (var i = 0; i < letters.length; i++) {{
        btns += '<button type="button" class="letter-btn" data-letter="' + letters[i] + '">' + letters[i] + '</button>';
      }}
      alphabetContainer.innerHTML = btns;

      renderPackages(packages);

      searchInput.addEventListener('input', function() {{
        applyFilters();
      }});

      var buttons = alphabetContainer.getElementsByClassName('letter-btn');
      for (var i = 0; i < buttons.length; i++) {{
        buttons[i].addEventListener('click', function(e) {{
          var letter = e.target.getAttribute('data-letter');

          if (activeLetter === letter) {{
            activeLetter = null;
          }} else {{
            activeLetter = letter;
          }}

          var allBtns = alphabetContainer.getElementsByClassName('letter-btn');
          for (var j = 0; j < allBtns.length; j++) {{
            if (allBtns[j].getAttribute('data-letter') === activeLetter) {{
              allBtns[j].classList.add('active');
            }} else {{
              allBtns[j].classList.remove('active');
            }}
          }}

          applyFilters();
        }});
      }}
    }})
    .catch(function(err) {{
      container.innerHTML = '<p>Error loading packages.</p>';
    }});
}});
</script>
```
'''

for category, title in categories.items():
    filename = f'{category}.qmd'
    content = template.format(title=title, category=category)
    with open(filename, 'w') as f:
        f.write(content)
    print(f'Created {filename}')
